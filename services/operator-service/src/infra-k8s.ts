/**
 * KubernetesVaultInfra — real provisioning adapters for the alpha cluster (B3-i).
 *
 * Each ensure* is idempotent (create-if-absent). External I/O goes through the
 * injected `fetch` so unit tests substitute a fake.
 */

import { readFileSync } from 'node:fs';
import { namespaceSlug, type VaultInfra, type RegistryFileEntry } from './infra.js';
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

export class KubernetesVaultInfra implements VaultInfra {
  private readonly gitRepos = new Map<string, string>();

  constructor(
    private readonly config: KubernetesVaultInfraConfig,
    private readonly _fetch: HttpFetch = globalThis.fetch.bind(globalThis),
  ) {}

  // ── GitHub repo (one per vault, B1 decision) ─────────────────────────────

  async ensureGitBackingStore(namespace: string, _adapter: string): Promise<void> {
    const slug = namespaceSlug(namespace);
    const repoName = `vault-${slug}`;

    const checkRes = await this._fetch(
      `https://api.github.com/repos/${this.config.githubOwner}/${repoName}`,
      { method: 'GET', headers: this.githubHeaders() },
    );
    if (checkRes.status === 200) {
      this.gitRepos.set(namespace, `${this.config.githubOwner}/${repoName}`);
      return;
    }

    const body = JSON.stringify({
      name: repoName,
      description: `Horus vault backing store for ${namespace}`,
      private: true,
      auto_init: true,
    });

    // Try org endpoint first, fall back to user endpoint.
    let createRes = await this._fetch(
      `https://api.github.com/orgs/${this.config.githubOwner}/repos`,
      { method: 'POST', headers: this.githubHeaders(), body },
    );
    if (createRes.status === 404) {
      createRes = await this._fetch(
        'https://api.github.com/user/repos',
        { method: 'POST', headers: this.githubHeaders(), body },
      );
    }
    if (!createRes.ok && createRes.status !== 422) {
      // 422 = already exists (race), treat as success
      throw new Error(`GitHub repo create failed: ${createRes.status} ${await createRes.text()}`);
    }
    this.gitRepos.set(namespace, `${this.config.githubOwner}/${repoName}`);
  }

  // ── Typesense per-vault collection ────────────────────────────────────────

  async ensureTypesenseCollection(namespace: string): Promise<void> {
    const slug = namespaceSlug(namespace);

    const checkRes = await this._fetch(
      `${this.config.typesenseUrl}/collections/${slug}`,
      { method: 'GET', headers: this.typesenseHeaders() },
    );
    if (checkRes.status === 200) return;

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

  async ensureRegistryEntry(namespace: string, _endpoint: string): Promise<void> {
    const slug = namespaceSlug(namespace);
    const entry: RegistryFileEntry = {
      reader_endpoint: this.config.readerEndpoint,
      writer_endpoint: this.config.writerEndpoint,
      typesense_collection: slug,
      neo4j_db: slug,
    };
    const gitRepo = this.gitRepos.get(namespace);
    if (gitRepo) entry.git_repo = gitRepo;

    const doc = await this.readConfigMap();
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
    try {
      const parsed = JSON.parse(raw);
      return { vaults: parsed.vaults ?? {} };
    } catch {
      return { vaults: {} };
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
