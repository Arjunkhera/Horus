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

export interface VaultInfra {
  ensureGitBackingStore(namespace: string, adapter: string): Promise<void>;
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

/** In-memory, idempotent VaultInfra. Tracks state so create-if-absent is observable. */
export class InMemoryVaultInfra implements VaultInfra {
  readonly git = new Map<string, string>();
  readonly collections = new Set<string>();
  readonly databases = new Set<string>();
  readonly registry = new Map<string, string>();

  async ensureGitBackingStore(namespace: string, adapter: string): Promise<void> {
    if (!this.git.has(namespace)) this.git.set(namespace, adapter);
  }
  async ensureTypesenseCollection(namespace: string): Promise<void> {
    this.collections.add(namespace);
  }
  async ensureNeo4jDatabase(namespace: string): Promise<void> {
    this.databases.add(namespace);
  }
  async ensureRegistryEntry(namespace: string, endpoint: string): Promise<void> {
    this.registry.set(namespace, endpoint);
  }
  async removeRegistryEntry(namespace: string): Promise<void> {
    this.registry.delete(namespace);
  }
  async dropTypesenseCollection(namespace: string): Promise<void> {
    this.collections.delete(namespace);
  }
  async dropNeo4jDatabase(namespace: string): Promise<void> {
    this.databases.delete(namespace);
  }
}

interface RegistryFileEntry {
  reader_endpoint: string;
  writer_endpoint: string;
  typesense_collection: string;
  neo4j_db: string;
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
    doc.vaults[namespace] = {
      reader_endpoint: this.readerEndpoint,
      writer_endpoint: this.writerEndpoint,
      typesense_collection: slug,
      neo4j_db: slug,
    };
    this.write(doc);
  }

  override async removeRegistryEntry(namespace: string): Promise<void> {
    await super.removeRegistryEntry(namespace);
    const doc = this.read();
    delete doc.vaults[namespace];
    this.write(doc);
  }
}
