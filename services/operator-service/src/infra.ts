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
