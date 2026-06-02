/**
 * HTTP-based DataAdapter that publishes artifacts to a remote Forge registry.
 *
 * Features:
 * - Pre-upload client-side Zod validation against `@forge/core` schemas
 *   (same schemas the server uses) so callers get fast, field-level feedback
 *   without a network round-trip.
 * - Attaches `X-Forge-Core-Version: <version>` header on every write so the
 *   registry can detect client/server compatibility skew.
 * - Translates 409 / 426 version-skew responses into a structured
 *   `ForgeCoreVersionMismatchError` with an actionable upgrade message.
 *
 * Read operations (`list`, `read`, `exists`) are delegated to the registry
 * HTTP API in a straightforward way; they carry no special validation or
 * version-skew logic.
 *
 * @example
 * const adapter = new HttpAdapter('https://registry.example.com', 'my-token');
 * await adapter.write('skill', 'my-skill', bundle);
 */

import type { ZodSchema } from 'zod';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { DataAdapter } from './types.js';
import type { ArtifactType, ArtifactBundle, ArtifactMeta } from '../models/index.js';
import {
  SkillMetaSchema,
  AgentMetaSchema,
  PluginMetaSchema,
  PersonaMetaSchema,
  WorkspaceConfigMetaSchema,
} from '../models/index.js';
import {
  ArtifactNotFoundError,
  InvalidMetadataError,
  PreUploadValidationError,
  ForgeCoreVersionMismatchError,
} from './errors.js';
import * as semver from 'semver';

// ---------------------------------------------------------------------------
// Package version (runtime read from package.json via createRequire)
// ---------------------------------------------------------------------------

import path from 'node:path';

function getPackageVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require(path.resolve(__dirname, '../../package.json')) as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

const PACKAGE_VERSION = getPackageVersion();

// ---------------------------------------------------------------------------
// Schema map (mirrors the server's META_SCHEMAS)
// ---------------------------------------------------------------------------

const META_SCHEMAS: Record<ArtifactType, ZodSchema> = {
  skill: SkillMetaSchema,
  agent: AgentMetaSchema,
  plugin: PluginMetaSchema,
  persona: PersonaMetaSchema,
  'workspace-config': WorkspaceConfigMetaSchema,
};

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/**
 * Shape of the JSON body returned by the registry when 409 or 426 is the
 * status AND the cause is a core-version incompatibility.
 */
interface VersionSkewBody {
  code: string;
  serviceVersion: string;
  clientVersion: string;
}

// ---------------------------------------------------------------------------
// HttpAdapter
// ---------------------------------------------------------------------------

/**
 * Options for constructing an HttpAdapter.
 */
export interface HttpAdapterOptions {
  /** Base URL of the Forge registry service (no trailing slash). */
  baseUrl: string;
  /** Optional bearer token for authenticated requests. */
  token?: string;
  /**
   * Override the forge/core package version sent in `X-Forge-Core-Version`.
   * Primarily used in tests.
   */
  coreVersion?: string;
  /**
   * Underlying fetch implementation.
   * Defaults to the global `fetch`. Override in tests or Node < 18.
   */
  fetch?: typeof fetch;
}

export class HttpAdapter implements DataAdapter {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly coreVersion: string;
  private readonly fetch: typeof fetch;

  constructor(options: HttpAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this.coreVersion = options.coreVersion ?? PACKAGE_VERSION;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  // ── Read operations ─────────────────────────────────────────────────────────

  async list(type: ArtifactType): Promise<ArtifactMeta[]> {
    // The registry exposes listing/search via `GET /artifacts?type=<type>`,
    // returning lightweight summary `hits` (not full bundles). Map those onto
    // the ArtifactMeta shape callers (Registry.search / Registry.list) read.
    const url = `${this.baseUrl}/artifacts?type=${encodeURIComponent(type)}&limit=250`;
    const res = await this.fetchJson(url, { method: 'GET' });
    if (!res.ok) {
      throw new Error(`Failed to list ${type} artifacts: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { hits?: Array<Record<string, unknown>> };
    const hits = data.hits ?? [];
    return hits.map((h) => ({
      id: String(h.artifact_id ?? h.id ?? ''),
      name: String(h.name ?? ''),
      version: String(h.version ?? ''),
      description: String(h.description ?? ''),
      type,
      tags: Array.isArray(h.tags) ? (h.tags as string[]) : [],
    })) as unknown as ArtifactMeta[];
  }

  /**
   * List all published semver versions for an artifact, highest-first.
   * Hits `GET /artifacts/:type/:id/versions`. Returns `[]` on 404 so the
   * resolver can fall back to flat-layout behaviour for legacy registries.
   */
  async listVersions(type: ArtifactType, rawId: string): Promise<string[]> {
    const { id } = parseVersionedId(rawId);
    const url = `${this.baseUrl}/artifacts/${type}/${id}/versions`;
    const res = await this.fetchJson(url, { method: 'GET' });
    if (res.status === 404) {
      return [];
    }
    if (!res.ok) {
      throw new Error(`Failed to list versions for ${type}:${id}: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { versions?: string[] };
    const versions = data.versions ?? [];
    // Server already sorts descending, but re-sort defensively.
    return [...versions].sort((a, b) => semver.rcompare(a, b));
  }

  async read(type: ArtifactType, rawId: string): Promise<ArtifactBundle> {
    const { id, version } = parseVersionedId(rawId);
    const resolvedVersion = version ?? (await this.latestVersion(type, id));
    if (!resolvedVersion) {
      throw new ArtifactNotFoundError(type, id);
    }

    const url = `${this.baseUrl}/artifacts/${type}/${id}/${resolvedVersion}`;
    const res = await this.fetchJson(url, { method: 'GET' });
    if (res.status === 404) {
      throw new ArtifactNotFoundError(type, id, url);
    }
    if (!res.ok) {
      throw new Error(`Failed to read ${type}:${id}@${resolvedVersion}: HTTP ${res.status}`);
    }

    // Server returns { type, id, version, files: { <name>: <base64> } }.
    const data = (await res.json()) as { files?: Record<string, string> };
    const files = data.files ?? {};

    // Decode + validate metadata.yaml (base64 → utf8 → yaml → Zod).
    const metaB64 = files['metadata.yaml'];
    if (!metaB64) {
      throw new InvalidMetadataError(url, 'registry response missing metadata.yaml');
    }
    const metaRaw = Buffer.from(metaB64, 'base64').toString('utf-8');
    const parsed = parseYaml(metaRaw);
    const schema = META_SCHEMAS[type];
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new InvalidMetadataError(
        url,
        result.error.issues[0]?.message ?? 'schema validation failed',
      );
    }

    // Decode the content file (SKILL.md / WORKSPACE.md / …). Optional for some
    // types (plugins, workspace-configs) — default to empty string, mirroring
    // FilesystemAdapter.read.
    const contentFile = CONTENT_FILES[type];
    const contentB64 = files[contentFile];
    const content = contentB64 ? Buffer.from(contentB64, 'base64').toString('utf-8') : '';

    return {
      meta: result.data as ArtifactMeta,
      content,
      contentPath: contentFile,
    };
  }

  async exists(type: ArtifactType, rawId: string): Promise<boolean> {
    const { id, version } = parseVersionedId(rawId);
    if (version) {
      const url = `${this.baseUrl}/artifacts/${type}/${id}/${version}`;
      const res = await this.fetchJson(url, { method: 'HEAD' });
      return res.ok;
    }
    // No explicit version — the artifact exists if it has at least one version.
    const versions = await this.listVersions(type, id);
    return versions.length > 0;
  }

  /** Resolve the highest published version, or undefined if none exist. */
  private async latestVersion(type: ArtifactType, id: string): Promise<string | undefined> {
    const versions = await this.listVersions(type, id);
    return versions[0];
  }

  // ── Write operation ─────────────────────────────────────────────────────────

  /**
   * Publish an artifact bundle to the remote registry.
   *
   * Before sending any HTTP request the bundle metadata is validated
   * client-side against the same Zod schema the server uses.  Validation
   * failures are surfaced as {@link PreUploadValidationError} with the same
   * field-level issue structure the server would return.
   *
   * Every write request carries the `X-Forge-Core-Version` header.  If the
   * server responds with 409 or 426 and a `CORE_VERSION_INCOMPATIBLE` code
   * the error is surfaced as {@link ForgeCoreVersionMismatchError}.
   */
  async write(type: ArtifactType, id: string, bundle: ArtifactBundle): Promise<void> {
    // ── Step 1: Client-side pre-upload Zod validation ────────────────────────
    const schema = META_SCHEMAS[type];
    const parseResult = schema.safeParse(bundle.meta);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      throw new PreUploadValidationError(type, issues);
    }

    // ── Step 2: Build the request ────────────────────────────────────────────
    const version = bundle.meta.version;
    const url = `${this.baseUrl}/artifacts/${type}/${id}/${version}`;

    const metaYaml = stringifyYaml(bundle.meta);
    const contentFile = CONTENT_FILES[type];

    // The publish route (POST /artifacts/:type/:id/:version) accepts a JSON
    // body of base64-encoded files — `{ files: { <name>: <base64> } }` — NOT
    // multipart/form-data. No multipart content-type parser is registered on
    // the server, so a FormData body was parsed as empty, the pipeline threw,
    // and the global error handler returned a generic 500 ("An unexpected
    // error occurred") that the MCP layer surfaced as UNKNOWN_ERROR — even
    // though the bundle was valid. Mirror the base64 contract used by read().
    const files: Record<string, string> = {
      'metadata.yaml': Buffer.from(metaYaml, 'utf-8').toString('base64'),
    };
    if (bundle.content) {
      files[contentFile] = Buffer.from(bundle.content, 'utf-8').toString('base64');
    }

    // ── Step 3: Send with version header ─────────────────────────────────────
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Forge-Core-Version': this.coreVersion,
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await this.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ files }),
    });

    // ── Step 4: Handle errors ────────────────────────────────────────────────
    if (!res.ok) {
      // Read the error body exactly once and reuse it for both version-skew
      // detection and the generic failure message — a Response body can only
      // be consumed once, so the previous two-block form threw on the second
      // read for a non-skew 409/426 and lost the server's error detail.
      let errBody:
        | (Partial<VersionSkewBody> & { error?: string; message?: string })
        | undefined;
      try {
        errBody = await res.json();
      } catch {
        // Body not JSON-parseable — fall through with the status code alone.
      }

      // Version-skew errors (409 / 426 with the incompatibility code).
      if (
        (res.status === 409 || res.status === 426) &&
        errBody?.code === 'CORE_VERSION_INCOMPATIBLE'
      ) {
        throw new ForgeCoreVersionMismatchError(
          errBody.serviceVersion ?? '',
          errBody.clientVersion ?? '',
        );
      }

      // Generic failure: surface the real status and the server's error
      // code/message so a failure is never collapsed into an opaque
      // "unexpected error". The registry returns `{ error, message }`.
      const parts = [errBody?.error, errBody?.message].filter(Boolean);
      const detail = parts.length ? `: ${parts.join(' — ')}` : '';
      throw new Error(
        `Failed to publish ${type}:${id}@${version} (HTTP ${res.status})${detail}`,
      );
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private fetchJson(url: string, init: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return this.fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        ...headers,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Content file name map (mirrors FilesystemAdapter)
// ---------------------------------------------------------------------------

const CONTENT_FILES: Record<ArtifactType, string> = {
  skill: 'SKILL.md',
  agent: 'AGENT.md',
  plugin: 'PLUGIN.md',
  persona: 'PERSONA.md',
  'workspace-config': 'WORKSPACE.md',
};

/**
 * Parse an artifact id that may carry a version suffix.
 *   "sdlc-default@1.2.0" -> { id: "sdlc-default", version: "1.2.0" }
 *   "sdlc-default"       -> { id: "sdlc-default", version: undefined }
 * Only treats the suffix as a version when it is valid semver (mirrors
 * FilesystemAdapter.parseVersionedId), so ids that legitimately contain '@'
 * are left intact.
 */
function parseVersionedId(rawId: string): { id: string; version: string | undefined } {
  const atIdx = rawId.lastIndexOf('@');
  if (atIdx > 0) {
    const possibleVersion = rawId.slice(atIdx + 1);
    if (semver.valid(possibleVersion)) {
      return { id: rawId.slice(0, atIdx), version: possibleVersion };
    }
  }
  return { id: rawId, version: undefined };
}
