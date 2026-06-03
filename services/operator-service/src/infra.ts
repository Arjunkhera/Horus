/**
 * VaultInfra — the logical-provisioning backend for C2 (§F catalog db07326b).
 *
 * "Logical provisioning" = no per-vault pods. Four reconciled resources:
 *   1. git repo/subdir backing store
 *   2. per-vault Typesense collection (versioned schema)
 *   3. dedicated Neo4j database
 *   4. vault-registry ConfigMap entry (namespace→endpoint; watched by router/writer)
 *
 * Real adapters (kubectl ConfigMap, Typesense/Neo4j clients) are wired at deploy
 * time (#10). The in-memory default keeps the service runnable and is what the
 * Provisioner tests assert against.
 */

/** Options for the git backing-store ensure step. */
export interface GitBackingStoreOpts {
  /** GitHub org/owner to create the repo under. Defaults to the configured GITHUB_OWNER. */
  gitOrg?: string;
  /** Explicit repo name. Defaults to `vault-${namespaceSlug(namespace)}`. */
  repoName?: string;
  /**
   * GitHub API hostname for this vault's backing repo. Empty or "github.com" →
   * public api.github.com; a GHE hostname (e.g. "github.intuit.com") targets
   * "https://<host>/api/v3". Overrides the operator-wide GITHUB_API_HOST default,
   * letting a single control plane back vaults on different hosts.
   */
  gitApiHost?: string;
}

export interface VaultInfra {
  /**
   * Checks whether the namespace is already registered in the vault-registry.
   * Used for NAMESPACE_EXISTS pre-flight before provisioning steps begin.
   */
  isNamespaceRegistered(namespace: string): Promise<boolean>;
  ensureGitBackingStore(namespace: string, adapter: string, opts?: GitBackingStoreOpts): Promise<void>;
  ensureTypesenseCollection(namespace: string): Promise<void>;
  ensureNeo4jDatabase(namespace: string): Promise<void>;
  ensureRegistryEntry(namespace: string, endpoint: string): Promise<void>;
  removeRegistryEntry(namespace: string): Promise<void>;
  dropTypesenseCollection(namespace: string): Promise<void>;
  dropNeo4jDatabase(namespace: string): Promise<void>;
}

/** namespace `owner/vault` → a Typesense/Neo4j-safe slug (`owner_vault`). */
export function namespaceSlug(namespace: string): string {
  return namespace.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * In-memory, idempotent VaultInfra. Tracks state so create-if-absent is observable.
 *
 * This class mirrors the collision semantics of KubernetesVaultInfra without
 * making real HTTP calls. It is used by unit tests and as the default infra when
 * neither K8s nor a file registry path is configured.
 *
 * Collision detection mirrors KubernetesVaultInfra:
 *   - gitRepos:     namespace → "org/repoName"
 *   - repoIndex:    "org/repoName" → owning namespace (reverse index for collision lookup)
 *   - collectionIndex: collection slug → owning namespace
 *   - registry:     namespace → endpoint (the "ConfigMap" in memory)
 *   - registryGitRepo: namespace → git_repo (parallel to registry for collision comparison)
 */
export class InMemoryVaultInfra implements VaultInfra {
  /** namespace → "org/repoName" (set by ensureGitBackingStore). */
  readonly gitRepos = new Map<string, string>();
  /**
   * Alias for gitRepos kept for backwards compatibility with existing tests
   * that use `infra.git.has(namespace)`. Same Map instance after construction.
   */
  readonly git: Map<string, string> = this.gitRepos;
  /** "org/repoName" → owning namespace (reverse lookup for REPO_PATH_IN_USE). */
  private readonly repoIndex = new Map<string, string>();
  /** collection slug → owning namespace (for COLLECTION_IN_USE). */
  private readonly collectionIndex = new Map<string, string>();
  /**
   * namespace → registered git_repo as written to the registry.
   * Used by NAMESPACE_EXISTS idempotency check (same git_repo = retry).
   */
  private readonly registryGitRepo = new Map<string, string | undefined>();
  readonly collections = new Set<string>();
  readonly databases = new Set<string>();
  /** namespace → endpoint (the mock registry). */
  readonly registry = new Map<string, string>();

  async isNamespaceRegistered(namespace: string): Promise<boolean> {
    return this.registry.has(namespace);
  }

  async ensureGitBackingStore(
    namespace: string,
    _adapter: string,
    opts?: GitBackingStoreOpts,
  ): Promise<void> {
    const slug = namespaceSlug(namespace);
    const org = opts?.gitOrg ?? 'default-org';
    const name = opts?.repoName ?? `vault-${slug}`;
    const repoPath = `${org}/${name}`;

    // REPO_PATH_IN_USE: check if another namespace already owns this path.
    const existingOwner = this.repoIndex.get(repoPath);
    if (existingOwner !== undefined && existingOwner !== namespace) {
      throw new InMemoryCollisionError(
        'REPO_PATH_IN_USE',
        `Git repo ${repoPath} is already owned by namespace "${existingOwner}".`,
        { conflicting_namespace: existingOwner, repo_path: repoPath },
      );
    }

    if (!this.gitRepos.has(namespace)) {
      this.gitRepos.set(namespace, repoPath);
      this.repoIndex.set(repoPath, namespace);
    }
  }

  async ensureTypesenseCollection(namespace: string): Promise<void> {
    const slug = namespaceSlug(namespace);

    // COLLECTION_IN_USE: check if another namespace already owns this slug.
    const existingOwner = this.collectionIndex.get(slug);
    if (existingOwner !== undefined && existingOwner !== namespace) {
      throw new InMemoryCollisionError(
        'COLLECTION_IN_USE',
        `Typesense collection "${slug}" is already owned by namespace "${existingOwner}".`,
        { conflicting_namespace: existingOwner, collection: slug },
      );
    }

    this.collections.add(namespace);
    if (!this.collectionIndex.has(slug)) {
      this.collectionIndex.set(slug, namespace);
    }
  }

  async ensureNeo4jDatabase(namespace: string): Promise<void> {
    this.databases.add(namespace);
  }

  async ensureRegistryEntry(namespace: string, endpoint: string): Promise<void> {
    this.registry.set(namespace, endpoint);
    this.registryGitRepo.set(namespace, this.gitRepos.get(namespace));
  }

  async removeRegistryEntry(namespace: string): Promise<void> {
    const gitRepo = this.registryGitRepo.get(namespace);
    if (gitRepo) this.repoIndex.delete(gitRepo);
    this.collectionIndex.delete(namespaceSlug(namespace));
    this.registry.delete(namespace);
    this.registryGitRepo.delete(namespace);
    this.gitRepos.delete(namespace);
  }
  async dropTypesenseCollection(namespace: string): Promise<void> {
    this.collections.delete(namespace);
  }
  async dropNeo4jDatabase(namespace: string): Promise<void> {
    this.databases.delete(namespace);
  }
}

/**
 * Collision error for InMemoryVaultInfra — structurally identical to the
 * KubernetesVaultInfra CollisionError so tests and the provisioner re-throw
 * path work uniformly.
 */
export class InMemoryCollisionError extends Error {
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
    this.name = 'CollisionError'; // same name as KubernetesVaultInfra's CollisionError
  }
}

export interface RegistryFileEntry {
  reader_endpoint: string;
  writer_endpoint: string;
  typesense_collection: string;
  neo4j_db: string;
  git_repo?: string;
}

/**
 * VaultInfra that persists the registry entry to a file in the exact shape
 * vault-router parses (JSON is valid YAML). This is the concrete writer of the
 * vault-registry (58aef4ad). In K8s, operator-service is the sole writer of the
 * vault-registry ConfigMap (enforced via RBAC); this file adapter is what
 * dev/local uses and what a ConfigMap-patch wrapper would feed. git/Typesense/
 * Neo4j ensure steps remain logical (tracked in-memory) per the alpha.
 */
export class FileVaultInfra extends InMemoryVaultInfra {
  constructor(
    private readonly registryPath: string,
    private readonly readerEndpoint: string,
    private readonly writerEndpoint: string,
    private readonly fs: {
      readFileSync: (p: string, enc: 'utf8') => string;
      writeFileSync: (p: string, data: string) => void;
      existsSync: (p: string) => boolean;
    },
  ) {
    super();
  }

  private read(): { vaults: Record<string, RegistryFileEntry> } {
    if (!this.fs.existsSync(this.registryPath)) return { vaults: {} };
    try {
      const parsed = JSON.parse(this.fs.readFileSync(this.registryPath, 'utf8'));
      return { vaults: parsed.vaults ?? {} };
    } catch {
      return { vaults: {} };
    }
  }

  private write(doc: { vaults: Record<string, RegistryFileEntry> }): void {
    this.fs.writeFileSync(this.registryPath, JSON.stringify(doc, null, 2));
  }

  override async ensureRegistryEntry(namespace: string, _endpoint: string): Promise<void> {
    await super.ensureRegistryEntry(namespace, _endpoint);
    const doc = this.read();
    const slug = namespaceSlug(namespace);
    const entry: RegistryFileEntry = {
      reader_endpoint: this.readerEndpoint,
      writer_endpoint: this.writerEndpoint,
      typesense_collection: slug,
      neo4j_db: slug,
    };
    const gitRepo = this.gitRepos.get(namespace);
    if (gitRepo) entry.git_repo = gitRepo;
    doc.vaults[namespace] = entry;
    this.write(doc);
  }

  override async removeRegistryEntry(namespace: string): Promise<void> {
    await super.removeRegistryEntry(namespace);
    const doc = this.read();
    delete doc.vaults[namespace];
    this.write(doc);
  }
}
