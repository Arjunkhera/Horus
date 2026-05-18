/**
 * RepoRegistryClient — HTTP client for the /repos endpoints on registry-service.
 *
 * Mirrors the HttpAdapter pattern for artifacts but targets the repo registry
 * routes added in RR-4. Includes an optional offline cache so callers can
 * fall back to the last known state when the registry is unreachable.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { RepoNotFoundError, RepoExistsError, RepoAmbiguousError } from './repo-errors.js';

// ---------------------------------------------------------------------------
// Types (mirror registry-service's repo-metadata.ts — no Zod runtime needed)
// ---------------------------------------------------------------------------

export interface RepoHost {
  url: string;
  provider: 'github' | 'gitlab' | 'bitbucket' | 'other';
  apiUrl?: string;
}

export interface RepoCredential {
  type: 'ssh-host' | 'gh-cli' | 'token-env' | 'git-credential' | 'mcp-tool';
  label: string;
  mcpServer?: string;
}

export interface RepoWorkflowMeta {
  type: 'owner' | 'fork' | 'contributor';
  pushTo: string;
  prTarget: { repo: string; branch: string };
  branchPattern?: string;
  commitFormat?: string;
  mergeStrategy?: 'squash' | 'rebase' | 'merge';
  hooks?: Record<string, unknown>;
}

export interface RepoVaultScope {
  repo: string;
  program?: string;
}

export interface RepoMetadataRecord {
  org: string;
  name: string;
  canonicalUrl: string;
  registeredAt: string;
  updatedAt: string;
  host?: RepoHost;
  credential?: RepoCredential;
  workflow?: RepoWorkflowMeta;
  vaultScope?: RepoVaultScope;
  description?: string;
  topics?: string[];
  language?: string;
  defaultBranch?: string;
  isPrivate?: boolean;
  isFork?: boolean;
  stars?: number;
  lastPushedAt?: string;
  extra?: Record<string, unknown>;
}

export type CreateRepoInput = Pick<RepoMetadataRecord, 'org' | 'name' | 'canonicalUrl'> &
  Partial<Omit<RepoMetadataRecord, 'org' | 'name' | 'canonicalUrl' | 'registeredAt' | 'updatedAt'>>;

export type PatchRepoInput = Partial<
  Omit<RepoMetadataRecord, 'org' | 'name' | 'registeredAt' | 'updatedAt'>
>;

export interface SearchParams {
  query?: string;
  org?: string;
  language?: string;
  framework?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  total: number;
  repos: RepoMetadataRecord[];
}

export interface ResolveResult {
  match: RepoMetadataRecord | null;
  ambiguous: boolean;
  candidates?: RepoMetadataRecord[];
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export interface RepoRegistryClientOptions {
  baseUrl: string;
  token?: string;
  /** Path to the offline cache JSON file. Omit to disable caching. */
  cachePath?: string;
  fetch?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Cache shape
// ---------------------------------------------------------------------------

interface RepoCache {
  repos: Record<string, RepoMetadataRecord>; // keyed by "{org}/{name}"
}

// ---------------------------------------------------------------------------
// RepoRegistryClient
// ---------------------------------------------------------------------------

export class RepoRegistryClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly cachePath: string | undefined;
  private readonly _fetch: typeof fetch;

  constructor(options: RepoRegistryClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this.cachePath = options.cachePath;
    this._fetch = options.fetch ?? globalThis.fetch;
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<{ status: number; data: T }> {
    const res = await this._fetch(url, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return { status: 204, data: undefined as unknown as T };
    const data = (await res.json()) as T;
    return { status: res.status, data };
  }

  // ── Cache helpers ─────────────────────────────────────────────────────────

  private async readCache(): Promise<RepoCache> {
    if (!this.cachePath) return { repos: {} };
    try {
      const raw = await fs.readFile(this.cachePath, 'utf8');
      return JSON.parse(raw) as RepoCache;
    } catch {
      return { repos: {} };
    }
  }

  private async writeCache(key: string, metadata: RepoMetadataRecord): Promise<void> {
    if (!this.cachePath) return;
    try {
      const cache = await this.readCache();
      cache.repos[key] = metadata;
      await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
      await fs.writeFile(this.cachePath, JSON.stringify(cache, null, 2), 'utf8');
    } catch {
      // cache write is best-effort
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async register(input: CreateRepoInput): Promise<RepoMetadataRecord> {
    const { status, data } = await this.request<RepoMetadataRecord & { error?: string }>(
      'POST',
      `${this.baseUrl}/repos`,
      input,
    );
    if (status === 409) throw new RepoExistsError(input.org, input.name);
    if (status >= 400) throw new Error(`Failed to register repo: ${JSON.stringify(data)}`);
    await this.writeCache(`${data.org}/${data.name}`, data);
    return data;
  }

  async get(org: string, name: string): Promise<RepoMetadataRecord> {
    try {
      const { status, data } = await this.request<RepoMetadataRecord & { error?: string }>(
        'GET',
        `${this.baseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(name)}`,
      );
      if (status === 404) throw new RepoNotFoundError(org, name);
      if (status >= 400) throw new Error(`Failed to get repo: ${JSON.stringify(data)}`);
      await this.writeCache(`${org}/${name}`, data);
      return data;
    } catch (err) {
      if (err instanceof RepoNotFoundError) throw err;
      // Network failure — try cache
      const cache = await this.readCache();
      const cached = cache.repos[`${org}/${name}`];
      if (cached) return cached;
      throw err;
    }
  }

  async update(org: string, name: string, patch: PatchRepoInput): Promise<RepoMetadataRecord> {
    const { status, data } = await this.request<RepoMetadataRecord & { error?: string }>(
      'PATCH',
      `${this.baseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(name)}`,
      patch,
    );
    if (status === 404) throw new RepoNotFoundError(org, name);
    if (status >= 400) throw new Error(`Failed to update repo: ${JSON.stringify(data)}`);
    await this.writeCache(`${org}/${name}`, data);
    return data;
  }

  async remove(org: string, name: string): Promise<void> {
    const { status, data } = await this.request<{ error?: string }>(
      'DELETE',
      `${this.baseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(name)}`,
    );
    if (status === 404) throw new RepoNotFoundError(org, name);
    if (status >= 400) throw new Error(`Failed to remove repo: ${JSON.stringify(data)}`);
  }

  async search(params?: SearchParams): Promise<SearchResult> {
    const qs = new URLSearchParams();
    if (params?.query) qs.set('q', params.query);
    if (params?.org) qs.set('org', params.org);
    if (params?.language) qs.set('language', params.language);
    if (params?.framework) qs.set('framework', params.framework);
    if (params?.tag) qs.set('tag', params.tag);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    const url = `${this.baseUrl}/repos${qs.size > 0 ? `?${qs.toString()}` : ''}`;
    const { status, data } = await this.request<SearchResult & { error?: string }>('GET', url);
    if (status >= 400) throw new Error(`Failed to search repos: ${JSON.stringify(data)}`);
    return data;
  }

  async resolve(params: { name?: string; url?: string }): Promise<ResolveResult> {
    if (!params.name && !params.url) {
      throw new Error('resolve() requires at least one of: name, url');
    }
    const qs = new URLSearchParams();
    if (params.name) qs.set('name', params.name);
    if (params.url) qs.set('url', params.url);

    try {
      const { status, data } = await this.request<
        ResolveResult & { error?: string; candidates?: RepoMetadataRecord[] }
      >('GET', `${this.baseUrl}/repos/resolve?${qs.toString()}`);

      if (status === 404) return { match: null, ambiguous: false };
      if (status >= 400) throw new Error(`Failed to resolve repo: ${JSON.stringify(data)}`);

      if (data.ambiguous && data.candidates) {
        throw new RepoAmbiguousError(
          params.name ?? params.url ?? '',
          data.candidates.map((c) => ({ org: c.org, name: c.name, canonicalUrl: c.canonicalUrl })),
        );
      }

      if (data.match) {
        await this.writeCache(`${data.match.org}/${data.match.name}`, data.match);
      }
      return data;
    } catch (err) {
      if (err instanceof RepoAmbiguousError) throw err;
      // Network failure — try cache for name lookups
      if (params.name) {
        const cache = await this.readCache();
        const matches = Object.values(cache.repos).filter((r) => r.name === params.name);
        if (matches.length === 1) return { match: matches[0]!, ambiguous: false };
        if (matches.length > 1) {
          throw new RepoAmbiguousError(
            params.name,
            matches.map((c) => ({ org: c.org, name: c.name, canonicalUrl: c.canonicalUrl })),
          );
        }
      }
      throw err;
    }
  }
}
