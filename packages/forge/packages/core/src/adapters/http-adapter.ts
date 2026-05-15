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
  PreUploadValidationError,
  ForgeCoreVersionMismatchError,
} from './errors.js';

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
    const url = `${this.baseUrl}/artifacts/${type}`;
    const res = await this.fetchJson(url, { method: 'GET' });
    if (!res.ok) {
      throw new Error(`Failed to list ${type} artifacts: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { artifacts: ArtifactMeta[] };
    return data.artifacts ?? [];
  }

  async read(type: ArtifactType, id: string): Promise<ArtifactBundle> {
    const url = `${this.baseUrl}/artifacts/${type}/${id}`;
    const res = await this.fetchJson(url, { method: 'GET' });
    if (res.status === 404) {
      throw new ArtifactNotFoundError(type, id, url);
    }
    if (!res.ok) {
      throw new Error(`Failed to read ${type}:${id}: HTTP ${res.status}`);
    }
    const data = (await res.json()) as ArtifactBundle;
    return data;
  }

  async exists(type: ArtifactType, id: string): Promise<boolean> {
    const url = `${this.baseUrl}/artifacts/${type}/${id}`;
    const res = await this.fetchJson(url, { method: 'HEAD' });
    return res.ok;
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

    const body = new FormData();
    body.append(
      'metadata.yaml',
      new Blob([metaYaml], { type: 'text/yaml' }),
      'metadata.yaml',
    );
    if (bundle.content) {
      body.append(
        contentFile,
        new Blob([bundle.content], { type: 'text/plain' }),
        contentFile,
      );
    }

    // ── Step 3: Send with version header ─────────────────────────────────────
    const headers: Record<string, string> = {
      'X-Forge-Core-Version': this.coreVersion,
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await this.fetch(url, {
      method: 'POST',
      headers,
      body,
    });

    // ── Step 4: Handle version-skew errors (409 / 426) ───────────────────────
    if (res.status === 409 || res.status === 426) {
      let skewBody: VersionSkewBody | undefined;
      try {
        skewBody = (await res.json()) as VersionSkewBody;
      } catch {
        // Body not parseable — fall through to generic error
      }

      if (skewBody?.code === 'CORE_VERSION_INCOMPATIBLE') {
        throw new ForgeCoreVersionMismatchError(
          skewBody.serviceVersion,
          skewBody.clientVersion,
        );
      }
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const errBody = (await res.json()) as { message?: string };
        if (errBody.message) detail = errBody.message;
      } catch {
        // ignore
      }
      throw new Error(`Failed to publish ${type}:${id}@${version}: ${detail}`);
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
