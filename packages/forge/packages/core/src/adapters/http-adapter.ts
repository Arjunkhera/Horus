/**
 * HTTP-based DataAdapter that communicates with the Forge Registry Service.
 *
 * Implements all six DataAdapter methods using Node.js native fetch:
 *   - list(type)                          → GET  /artifacts?type={type}
 *   - read(type, id[, version])           → GET  /artifacts/{type}/{id}/{version}
 *   - exists(type, id[, version])         → HEAD /artifacts/{type}/{id}/{version}
 *   - write(type, id, bundle)             → POST /artifacts/{type}/{id}/{version}
 *   - listVersions(type, id)              → GET  /artifacts/{type}/{id}/versions
 *   - readResourceFile(type, id, path)    → GET  /artifacts/{type}/{id}/{version}/resources/{path}
 *
 * Auth: bearer token from registry config attached as `Authorization: Bearer <token>`.
 * Read endpoints operate without a token. Write endpoints require a token.
 *
 * @example
 * const adapter = new HttpAdapter({
 *   baseUrl: 'https://registry.horus.dev/v1',
 *   token: process.env.FORGE_REGISTRY_TOKEN,
 * });
 */

import { parse as parseYaml } from 'yaml';
import * as semver from 'semver';
import type { DataAdapter } from './types.js';
import type { ArtifactType, ArtifactBundle, ArtifactMeta } from '../models/index.js';
import {
  SkillMetaSchema,
  AgentMetaSchema,
  PluginMetaSchema,
  PersonaMetaSchema,
  WorkspaceConfigMetaSchema,
} from '../models/index.js';
import { ArtifactNotFoundError, AdapterError } from './errors.js';

// ── Config ─────────────────────────────────────────────────────────────────────

export interface HttpAdapterConfig {
  /** Base URL of the registry service (e.g., "http://localhost:3000" or "https://registry.horus.dev/v1"). */
  baseUrl: string;
  /** Optional bearer token for authenticated (write) operations. */
  token?: string;
}

// ── Zod schemas keyed by type ──────────────────────────────────────────────────

const SCHEMAS = {
  skill: SkillMetaSchema,
  agent: AgentMetaSchema,
  plugin: PluginMetaSchema,
  persona: PersonaMetaSchema,
  'workspace-config': WorkspaceConfigMetaSchema,
};

// Content file names for each type (mirrors FilesystemAdapter)
const CONTENT_FILES: Record<ArtifactType, string> = {
  skill: 'SKILL.md',
  agent: 'AGENT.md',
  plugin: 'PLUGIN.md',
  persona: 'PERSONA.md',
  'workspace-config': 'WORKSPACE.md',
};

// ── Version helpers ────────────────────────────────────────────────────────────

/**
 * Parse an artifact ID that may contain a version suffix.
 * e.g., "sdlc-developer@1.1.0" → { id: "sdlc-developer", version: "1.1.0" }
 * e.g., "sdlc-developer"       → { id: "sdlc-developer", version: undefined }
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

// ── Response shapes ────────────────────────────────────────────────────────────

interface SearchHit {
  type: string;
  artifact_id: string;
  version: string;
  name: string;
  description: string;
  tags: string[];
}

interface SearchResponse {
  hits?: SearchHit[];
}

interface ReadResponse {
  type: string;
  id: string;
  version: string;
  /** filename → base64-encoded content */
  files: Record<string, string>;
}

interface VersionsResponse {
  versions: string[];
}

// ── HttpAdapter ────────────────────────────────────────────────────────────────

export class HttpAdapter implements DataAdapter {
  private readonly baseUrl: string;
  private readonly token?: string;

  constructor(config: HttpAdapterConfig) {
    // Strip trailing slash for consistent URL construction
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.token = config.token;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private buildHeaders(includeAuth = false): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (includeAuth && this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  private buildWriteHeaders(coreVersion?: string): Record<string, string> {
    const headers = this.buildHeaders(true);
    if (coreVersion) {
      headers['X-Forge-Core-Version'] = coreVersion;
    }
    return headers;
  }

  /**
   * Resolve the version to use for an artifact ID.
   * If rawId contains an `@version` suffix, use that version.
   * Otherwise, fetch all versions and return the latest (highest semver).
   * Returns null if no versions are found.
   */
  private async resolveVersion(type: ArtifactType, rawId: string): Promise<{ id: string; version: string | null }> {
    const { id, version } = parseVersionedId(rawId);
    if (version) {
      return { id, version };
    }
    // Fetch available versions and pick the latest
    const versions = await this.listVersions(type, id);
    if (versions.length === 0) {
      return { id, version: null };
    }
    return { id, version: versions[0]! };
  }

  /**
   * Wrap a fetch call with standard error handling.
   * @throws {AdapterError} on network errors
   */
  private async safeFetch(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (err: any) {
      throw new AdapterError(
        'HttpAdapter',
        `Network request failed for ${url}: ${err.message}`,
        'Check that the registry service is running and the URL is correct in forge.yaml',
      );
    }
  }

  // ── DataAdapter implementation ───────────────────────────────────────────────

  /**
   * List all artifacts of the given type.
   * Calls GET /artifacts?type={type} and maps search hits to ArtifactMeta.
   */
  async list(type: ArtifactType): Promise<ArtifactMeta[]> {
    const url = `${this.baseUrl}/artifacts?type=${encodeURIComponent(type)}`;
    const response = await this.safeFetch(url, {
      method: 'GET',
      headers: this.buildHeaders(false),
    });

    if (!response.ok) {
      console.warn(
        `[HttpAdapter] list(${type}) returned HTTP ${response.status}. Returning empty list.`,
      );
      return [];
    }

    let body: SearchResponse;
    try {
      body = (await response.json()) as SearchResponse;
    } catch {
      console.warn(`[HttpAdapter] list(${type}) returned non-JSON response. Returning empty list.`);
      return [];
    }

    const hits = body.hits ?? [];
    const results: ArtifactMeta[] = [];

    for (const hit of hits) {
      // Construct a minimal ArtifactMeta from the search document.
      // The search document only carries summary fields; full metadata
      // requires a separate read() call. This is sufficient for list views.
      const partial: Record<string, unknown> = {
        id: hit.artifact_id,
        name: hit.name,
        version: hit.version,
        description: hit.description,
        type: hit.type,
        tags: hit.tags ?? [],
      };

      const schema = SCHEMAS[type];
      if (!schema) continue;
      const result = schema.safeParse(partial);
      if (result.success) {
        results.push(result.data as ArtifactMeta);
      } else {
        // Search doc may be missing optional fields — include with defaults
        console.warn(
          `[HttpAdapter] list(${type}): skipping malformed hit for '${hit.artifact_id}': ${result.error.errors[0]?.message}`,
        );
      }
    }

    return results;
  }

  /**
   * Read a full artifact bundle (metadata + content).
   * Calls GET /artifacts/{type}/{id}/{version}.
   * @throws {ArtifactNotFoundError} if artifact doesn't exist (404)
   * @throws {AdapterError} on network failure
   */
  async read(type: ArtifactType, rawId: string): Promise<ArtifactBundle> {
    const { id, version } = await this.resolveVersion(type, rawId);

    if (!version) {
      throw new ArtifactNotFoundError(type, rawId, this.baseUrl);
    }

    const url = `${this.baseUrl}/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(id)}/${encodeURIComponent(version)}`;
    const response = await this.safeFetch(url, {
      method: 'GET',
      headers: this.buildHeaders(false),
    });

    if (response.status === 404) {
      throw new ArtifactNotFoundError(type, rawId, this.baseUrl);
    }

    if (!response.ok) {
      throw new AdapterError(
        'HttpAdapter',
        `read(${type}, ${rawId}) returned HTTP ${response.status}`,
        'Check that the artifact exists in the registry',
      );
    }

    let body: ReadResponse;
    try {
      body = (await response.json()) as ReadResponse;
    } catch (err: any) {
      throw new AdapterError(
        'HttpAdapter',
        `read(${type}, ${rawId}): failed to parse JSON response: ${err.message}`,
      );
    }

    // Decode files map: filename → base64 → Buffer → string
    const files = new Map<string, string>();
    for (const [filename, b64] of Object.entries(body.files ?? {})) {
      files.set(filename, Buffer.from(b64, 'base64').toString('utf-8'));
    }

    // Parse metadata.yaml
    const metadataYaml = files.get('metadata.yaml');
    if (!metadataYaml) {
      throw new AdapterError(
        'HttpAdapter',
        `read(${type}, ${rawId}): bundle missing metadata.yaml`,
        'The registry may have a corrupted artifact',
      );
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(metadataYaml);
    } catch (err: any) {
      throw new AdapterError(
        'HttpAdapter',
        `read(${type}, ${rawId}): failed to parse metadata.yaml: ${err.message}`,
      );
    }

    const schema = SCHEMAS[type];
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new AdapterError(
        'HttpAdapter',
        `read(${type}, ${rawId}): invalid metadata — ${result.error.errors[0]?.message}`,
        'The registry may have a corrupted artifact',
      );
    }

    const meta = result.data as ArtifactMeta;
    const contentFile = CONTENT_FILES[type];
    const content = files.get(contentFile) ?? '';

    return { meta, content, contentPath: contentFile };
  }

  /**
   * Check if an artifact exists without reading content.
   * Calls HEAD /artifacts/{type}/{id}/{version}.
   */
  async exists(type: ArtifactType, rawId: string): Promise<boolean> {
    const { id, version } = await this.resolveVersion(type, rawId);

    if (!version) {
      return false;
    }

    const url = `${this.baseUrl}/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(id)}/${encodeURIComponent(version)}`;
    let response: Response;
    try {
      response = await this.safeFetch(url, {
        method: 'HEAD',
        headers: this.buildHeaders(false),
      });
    } catch {
      return false;
    }

    return response.status === 200;
  }

  /**
   * Write an artifact to the registry (for publishing).
   * Calls POST /artifacts/{type}/{id}/{version} with X-Forge-Core-Version header.
   * @throws {AdapterError} on HTTP error or network failure
   */
  async write(type: ArtifactType, rawId: string, bundle: ArtifactBundle): Promise<void> {
    const { id } = parseVersionedId(rawId);
    const version = bundle.meta.version;

    const url = `${this.baseUrl}/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(id)}/${encodeURIComponent(version)}`;

    // Build files map: filename → base64-encoded content
    const { stringify: stringifyYaml } = await import('yaml');
    const metadataYaml = stringifyYaml(bundle.meta);
    const contentFile = CONTENT_FILES[type];

    const files: Record<string, string> = {
      'metadata.yaml': Buffer.from(metadataYaml, 'utf-8').toString('base64'),
    };
    if (bundle.content) {
      files[contentFile] = Buffer.from(bundle.content, 'utf-8').toString('base64');
    }

    const response = await this.safeFetch(url, {
      method: 'POST',
      headers: this.buildWriteHeaders(),
      body: JSON.stringify({ files }),
    });

    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`;
      try {
        const body = (await response.json()) as { message?: string; error?: string };
        errorDetail = body.message ?? body.error ?? errorDetail;
      } catch {
        // Ignore JSON parse errors for error responses
      }
      throw new AdapterError(
        'HttpAdapter',
        `write(${type}, ${id}@${version}) failed: ${errorDetail}`,
        'Check that you have write access to the registry and the version does not already exist',
      );
    }
  }

  /**
   * List all available semver versions for a specific artifact.
   * Calls GET /artifacts/{type}/{id}/versions.
   * Returns versions sorted descending (highest first).
   */
  async listVersions(type: ArtifactType, id: string): Promise<string[]> {
    const url = `${this.baseUrl}/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(id)}/versions`;
    let response: Response;
    try {
      response = await this.safeFetch(url, {
        method: 'GET',
        headers: this.buildHeaders(false),
      });
    } catch {
      return [];
    }

    if (!response.ok) {
      return [];
    }

    let body: VersionsResponse;
    try {
      body = (await response.json()) as VersionsResponse;
    } catch {
      return [];
    }

    const versions = (body.versions ?? []).filter((v) => semver.valid(v));
    // Sort descending — highest version first
    return versions.sort((a, b) => semver.rcompare(a, b));
  }

  /**
   * Read a resource file from an artifact's directory by relative path.
   * Calls GET /artifacts/{type}/{id}/{version}/resources/{path}.
   * Returns null if the file doesn't exist (404).
   */
  async readResourceFile(type: ArtifactType, rawId: string, relativePath: string): Promise<string | null> {
    const { id, version } = await this.resolveVersion(type, rawId);

    if (!version) {
      return null;
    }

    // Normalize the path: strip leading slashes and 'resources/' prefix if already present
    const normalizedPath = relativePath.replace(/^\/+/, '').replace(/^resources\//, '');
    const url = `${this.baseUrl}/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(id)}/${encodeURIComponent(version)}/resources/${normalizedPath}`;

    let response: Response;
    try {
      response = await this.safeFetch(url, {
        method: 'GET',
        headers: this.buildHeaders(false),
      });
    } catch {
      return null;
    }

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      console.warn(
        `[HttpAdapter] readResourceFile(${type}, ${rawId}, ${relativePath}) returned HTTP ${response.status}`,
      );
      return null;
    }

    try {
      return await response.text();
    } catch {
      return null;
    }
  }
}
