/**
 * KubernetesVaultInfra — real provisioning adapters for the alpha cluster (B3-i).
 *
 * Each ensure* is idempotent (create-if-absent). External I/O goes through the
 * injected `fetch` so unit tests substitute a fake.
 *
 * Collision semantics (P2):
 *   - vault-registry ConfigMap is the source of truth for what is provisioned.
 *   - Before creating any new resource, ensureGitBackingStore / ensureTypesenseCollection
 *     check whether the resolved path is already owned by a DIFFERENT namespace.
 *   - A retry of the SAME namespace re-entering an already-started step is NOT a collision
 *     (idempotent resume — the provisioner's steps ledger guarantees each step only runs
 *     once per request, so if this method is called it's either the first attempt or a
 *     retry of a step that had not yet been marked complete).
 */

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import {
  namespaceSlug,
  type VaultInfra,
  type RegistryFileEntry,
  type GitBackingStoreOpts,
} from './infra.js';
import { collectionCreateBody } from '@horus/search';

export interface KubernetesVaultInfraConfig {
  githubToken: string;
  githubOwner: string;
  typesenseUrl: string;
  typesenseApiKey: string;
  k8sApiUrl: string;
  k8sToken: string;
  k8sNamespace: string;
  configMapName: string;
  configMapKey: string;
  readerEndpoint: string;
  writerEndpoint: string;
}

interface FetchResponse {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type HttpFetch = (url: string, init?: RequestInit) => Promise<FetchResponse>;

/** Structured error thrown when a resource is already owned by another namespace. */
export class CollisionError extends Error {
  constructor(
    public readonly code:
      | 'NAMESPACE_EXISTS'
      | 'REPO_PATH_IN_USE'
      | 'COLLECTION_IN_USE'
      | 'NEO4J_DB_IN_USE',
    message: string,
    public readonly details: Record<string, string>,
  ) {
    super(message);
    this.name = 'CollisionError';
  }
}

/** Thrown when the GitHub owner is empty/unresolvable — a config error, not a collision. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class KubernetesVaultInfra implements VaultInfra {
  /**
   * Per-instance record of namespace → resolved "org/repoName" path.
   * Populated in ensureGitBackingStore; consumed in ensureRegistryEntry.
   */
  private readonly gitRepos = new Map<string, string>();

  /**
   * Cached login of the authenticated GitHub token (lowercased).
   * Resolved on first call to resolveTokenLogin(); null = not yet fetched,
   * '' (empty) = fetch failed or returned non-200.
   */
  private _tokenLogin: string | null = null;

  constructor(
    private readonly config: KubernetesVaultInfraConfig,
    private readonly _fetch: HttpFetch = globalThis.fetch.bind(globalThis),
  ) {}

  // ── GitHub identity resolution ────────────────────────────────────────────

  /**
   * Returns the lowercase login of the authenticated GitHub token, or ''
   * if the identity lookup fails (non-200 or network error).  Cached after
   * the first successful fetch so repeated provisions do not re-query.
   */
  private async resolveTokenLogin(): Promise<string> {
    if (this._tokenLogin !== null) return this._tokenLogin;
    try {
      const res = await this._fetch(
        'https://api.github.com/user',
        { method: 'GET', headers: this.githubHeaders() },
      );
      if (res.status === 200) {
        const data = (await res.json()) as { login?: string };
        this._tokenLogin = (data.login ?? '').toLowerCase();
      } else {
        this._tokenLogin = '';
      }
    } catch {
      this._tokenLogin = '';
    }
    return this._tokenLogin;
  }

  // ── Registry pre-flight ───────────────────────────────────────────────────

  /** Returns true if the namespace key already exists in the vault-registry ConfigMap. */
  async isNamespaceRegistered(namespace: string): Promise<boolean> {
    const doc = await this.readConfigMap();
    return namespace in doc.vaults;
  }

  // ── GitHub repo (one per vault, B1 decision) ─────────────────────────────

  /**
   * Ensures the GitHub repo exists.
   *
   * Resolution order:
   *   org  = opts.gitOrg  ?? config.githubOwner  (error if still empty)
   *   name = opts.repoName ?? `vault-${slug}`
   *
   * Collision rules (vault-registry ConfigMap is source of truth):
   *   - If a DIFFERENT namespace already owns this org/name path → REPO_PATH_IN_USE 409.
   *   - If the repo exists on GitHub but is NOT owned by this namespace → REPO_PATH_IN_USE 409.
   *     (No silent adoption — a pre-existing unowned repo must be explicitly dealt with.)
   *   - If the namespace already owns this path (same request retry) → idempotent success.
   *
   * Endpoint selection: before creating, the method calls GET /user to determine
   * whether the resolved owner is the authenticated token's own personal account.
   * If so, POST /user/repos is used (GitHub rejects POST /orgs/{personal} with 404).
   * Otherwise POST /orgs/{org}/repos is used. The result is cached per instance.
   */
  async ensureGitBackingStore(
    namespace: string,
    _adapter: string,
    opts?: GitBackingStoreOpts,
  ): Promise<void> {
    const slug = namespaceSlug(namespace);

    // Resolve org and name — fail fast on empty owner.
    const org = opts?.gitOrg ?? this.config.githubOwner;
    if (!org || org.trim() === '') {
      throw new ConfigError(
        'GITHUB_OWNER is not configured and no git_org was provided in the payload. ' +
          'Set the GITHUB_OWNER env var or pass git_org in the vault_create payload.',
      );
    }
    const name = opts?.repoName ?? `vault-${slug}`;
    const repoPath = `${org}/${name}`;

    // ── Registry-level collision check ────────────────────────────────────
    // Read the current registry and verify the resolved path is not already
    // owned by a different namespace. Owning this namespace (a retry) is allowed.
    const registryDoc = await this.readConfigMap();
    for (const [existingNs, entry] of Object.entries(registryDoc.vaults)) {
      if (existingNs === namespace) continue; // same namespace = retry, not a collision
      if (entry.git_repo === repoPath) {
        throw new CollisionError(
          'REPO_PATH_IN_USE',
          `Git repo ${repoPath} is already owned by namespace "${existingNs}". ` +
            `Choose a different git_org/repo_name or delete the existing vault first.`,
          { conflicting_namespace: existingNs, repo_path: repoPath },
        );
      }
    }

    // ── GitHub existence check ────────────────────────────────────────────
    const checkRes = await this._fetch(
      `https://api.github.com/repos/${org}/${name}`,
      { method: 'GET', headers: this.githubHeaders() },
    );

    if (checkRes.status === 200) {
      // Repo exists on GitHub. Accept it only if this namespace already owns it
      // (the registry check above would have thrown if another namespace did).
      // If no registry entry exists for this namespace yet, the repo is unowned
      // on GitHub but exists — that's a collision (no silent adoption).
      const thisEntry = registryDoc.vaults[namespace];
      if (!thisEntry) {
        // Repo exists on GitHub but not in registry → pre-existing unowned repo.
        throw new CollisionError(
          'REPO_PATH_IN_USE',
          `Git repo ${repoPath} already exists on GitHub but is not registered to any vault. ` +
            `Delete or rename the repo, or pass a different repo_name in the payload.`,
          { repo_path: repoPath, github_status: '200' },
        );
      }
      // Namespace already has a registry entry (retry path) — accept it.
      this.gitRepos.set(namespace, repoPath);
      return;
    }

    // ── Create the repo ───────────────────────────────────────────────────
    const body = JSON.stringify({
      name,
      description: `Horus vault backing store for ${namespace}`,
      private: true,
      auto_init: true,
    });

    // Resolve whether `org` is the authenticated token's own user account.
    // If so, repos must be created via POST /user/repos (GitHub rejects
    // POST /orgs/{personal-login}/repos with 404).
    const tokenLogin = await this.resolveTokenLogin();
    const isTokenUser = tokenLogin !== '' && tokenLogin === org.toLowerCase();
    const createUrl = isTokenUser
      ? 'https://api.github.com/user/repos'
      : `https://api.github.com/orgs/${org}/repos`;

    const createRes = await this._fetch(
      createUrl,
      { method: 'POST', headers: this.githubHeaders(), body },
    );

    if (!createRes.ok && createRes.status !== 422) {
      // 422 = repo name already exists (race), treat as success.
      const detail = await createRes.text();
      const endpointLabel = isTokenUser ? '/user/repos' : `/orgs/${org}/repos`;
      throw new Error(
        `GitHub repo create failed for owner "${org}" via ${endpointLabel}: ` +
          `HTTP ${createRes.status} — ${detail}`,
      );
    }

    this.gitRepos.set(namespace, repoPath);
  }

  // ── Typesense per-vault collection ────────────────────────────────────────

  /**
   * Ensures the Typesense collection exists.
   *
   * Collision rule: if the collection slug is already referenced by a DIFFERENT
   * registry entry, throw COLLECTION_IN_USE. If it exists in Typesense but is
   * unregistered (unowned), throw COLLECTION_IN_USE — no silent adoption.
   */
  async ensureTypesenseCollection(namespace: string): Promise<void> {
    const slug = namespaceSlug(namespace);

    // ── Registry-level collision check ────────────────────────────────────
    const registryDoc = await this.readConfigMap();
    for (const [existingNs, entry] of Object.entries(registryDoc.vaults)) {
      if (existingNs === namespace) continue; // retry — not a collision
      if (entry.typesense_collection === slug) {
        throw new CollisionError(
          'COLLECTION_IN_USE',
          `Typesense collection "${slug}" is already owned by namespace "${existingNs}". ` +
            `The namespace slug collides — choose a different namespace.`,
          { conflicting_namespace: existingNs, collection: slug },
        );
      }
    }

    const checkRes = await this._fetch(
      `${this.config.typesenseUrl}/collections/${slug}`,
      { method: 'GET', headers: this.typesenseHeaders() },
    );

    if (checkRes.status === 200) {
      // Collection exists. If this namespace already owns it (retry), that's fine.
      // If there is no registry entry for this namespace yet, it's unowned → collision.
      const thisEntry = registryDoc.vaults[namespace];
      if (!thisEntry) {
        throw new CollisionError(
          'COLLECTION_IN_USE',
          `Typesense collection "${slug}" already exists but is not registered to any vault. ` +
            `Drop the collection manually or choose a different namespace.`,
          { collection: slug, typesense_status: '200' },
        );
      }
      return; // retry — idempotent
    }

    const schema = collectionCreateBody(slug);
    const createRes = await this._fetch(
      `${this.config.typesenseUrl}/collections`,
      {
        method: 'POST',
        headers: this.typesenseHeaders(),
        body: JSON.stringify(schema),
      },
    );
    if (!createRes.ok && createRes.status !== 409) {
      throw new Error(
        `Typesense collection create failed: ${createRes.status} ${await createRes.text()}`,
      );
    }
  }

  // ── Neo4j: logical no-op (decision dc028173) ─────────────────────────────
  // Alpha runs Neo4j Community (single-db). Per-vault DB deferred to B5.
  // The vault_name property scope is applied on the vault-service side.

  async ensureNeo4jDatabase(_namespace: string): Promise<void> {}

  // ── vault-registry ConfigMap ──────────────────────────────────────────────

  /**
   * Ensures the registry entry exists.
   *
   * NAMESPACE_EXISTS pre-flight is handled by the `check_namespace_collision`
   * step in vaultCreateHandler (via isNamespaceRegistered) before this step
   * runs. This method simply writes the entry, relying on the Provisioner's
   * steps ledger to ensure it runs at most once per request.
   */
  async ensureRegistryEntry(namespace: string, _endpoint: string): Promise<void> {
    const slug = namespaceSlug(namespace);
    const doc = await this.readConfigMap();

    const entry: RegistryFileEntry = {
      reader_endpoint: this.config.readerEndpoint,
      writer_endpoint: this.config.writerEndpoint,
      typesense_collection: slug,
      neo4j_db: slug,
    };
    const gitRepo = this.gitRepos.get(namespace);
    if (gitRepo) entry.git_repo = gitRepo;

    doc.vaults[namespace] = entry;
    await this.patchConfigMap(doc);
  }

  async removeRegistryEntry(namespace: string): Promise<void> {
    const doc = await this.readConfigMap();
    delete doc.vaults[namespace];
    await this.patchConfigMap(doc);
  }

  async dropTypesenseCollection(namespace: string): Promise<void> {
    const slug = namespaceSlug(namespace);
    const res = await this._fetch(
      `${this.config.typesenseUrl}/collections/${slug}`,
      { method: 'DELETE', headers: this.typesenseHeaders() },
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(
        `Typesense collection delete failed: ${res.status} ${await res.text()}`,
      );
    }
  }

  async dropNeo4jDatabase(_namespace: string): Promise<void> {}

  // ── K8s ConfigMap read/patch ──────────────────────────────────────────────

  private async readConfigMap(): Promise<{ vaults: Record<string, RegistryFileEntry> }> {
    const url =
      `${this.config.k8sApiUrl}/api/v1/namespaces/${this.config.k8sNamespace}` +
      `/configmaps/${this.config.configMapName}`;
    const res = await this._fetch(url, { method: 'GET', headers: this.k8sHeaders() });
    if (!res.ok) {
      throw new Error(`ConfigMap read failed: ${res.status} ${await res.text()}`);
    }
    const cm = (await res.json()) as { data?: Record<string, string> };
    const raw = cm.data?.[this.config.configMapKey] ?? '';
    if (!raw.trim()) {
      // Legitimately empty ConfigMap — nothing seeded yet.
      return { vaults: {} };
    }
    try {
      // Use YAML parser: handles both the YAML seed (with comments) and the
      // operator's own JSON writes (JSON is valid YAML). Never silently swallow
      // a non-empty parse failure — that caused the seeded `default` entry to
      // be clobbered on the first write.
      const parsed = parseYaml(raw) as { vaults?: Record<string, RegistryFileEntry> } | null;
      return { vaults: parsed?.vaults ?? {} };
    } catch (err) {
      throw new Error(
        `ConfigMap registry parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async patchConfigMap(
    doc: { vaults: Record<string, RegistryFileEntry> },
  ): Promise<void> {
    const url =
      `${this.config.k8sApiUrl}/api/v1/namespaces/${this.config.k8sNamespace}` +
      `/configmaps/${this.config.configMapName}`;
    const yamlContent = this.registryToYaml(doc);
    const patch = { data: { [this.config.configMapKey]: yamlContent } };
    const res = await this._fetch(url, {
      method: 'PATCH',
      headers: {
        ...this.k8sHeaders(),
        'content-type': 'application/strategic-merge-patch+json',
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      throw new Error(`ConfigMap patch failed: ${res.status} ${await res.text()}`);
    }
  }

  private registryToYaml(doc: { vaults: Record<string, RegistryFileEntry> }): string {
    // JSON is valid YAML — vault-router uses yaml.safe_load which accepts JSON.
    return JSON.stringify(doc, null, 2);
  }

  // ── Header builders ───────────────────────────────────────────────────────

  private githubHeaders(): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.githubToken}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    };
  }

  private typesenseHeaders(): Record<string, string> {
    return { 'x-typesense-api-key': this.config.typesenseApiKey };
  }

  private k8sHeaders(): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.k8sToken}`,
      accept: 'application/json',
      'content-type': 'application/json',
    };
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createKubernetesVaultInfra(): KubernetesVaultInfra | null {
  const k8sHost = process.env.KUBERNETES_SERVICE_HOST;
  if (!k8sHost) return null;

  const k8sPort = process.env.KUBERNETES_SERVICE_PORT ?? '443';
  let k8sToken: string;
  try {
    k8sToken = readFileSync(
      '/var/run/secrets/kubernetes.io/serviceaccount/token',
      'utf8',
    ).trim();
  } catch {
    return null;
  }

  return new KubernetesVaultInfra({
    githubToken: process.env.GITHUB_TOKEN ?? '',
    githubOwner: process.env.GITHUB_OWNER ?? '',
    typesenseUrl: process.env.TYPESENSE_URL ?? 'http://typesense:8108',
    typesenseApiKey: process.env.TYPESENSE_API_KEY ?? '',
    k8sApiUrl: `https://${k8sHost}:${k8sPort}`,
    k8sToken,
    k8sNamespace: process.env.VAULT_REGISTRY_NAMESPACE ?? 'horus-system',
    configMapName: process.env.VAULT_REGISTRY_CONFIGMAP ?? 'vault-registry',
    configMapKey: process.env.VAULT_REGISTRY_KEY ?? 'registry.yaml',
    readerEndpoint:
      process.env.VAULT_READER_URL ??
      'http://vault-reader.horus-system.svc.cluster.local:8000',
    writerEndpoint:
      process.env.VAULT_WRITER_URL ??
      'http://vault-writer.horus-system.svc.cluster.local:8000',
  });
}
