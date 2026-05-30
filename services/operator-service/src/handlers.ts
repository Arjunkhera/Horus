/** Per-kind provisioning handlers (MVP: onboard, vault create/attach/delete). */

import type { KindHandler } from './provisioner.js';
import type { VaultInfra } from './infra.js';
import type { Store } from './store.js';

function vaultEndpoint(payload: Record<string, unknown>, namespace: string): string {
  if (typeof payload.endpoint === 'string') return payload.endpoint;
  return `${String(payload.target_router ?? 'vault-router')}/vaults/${namespace}`;
}

/** A1 onboard: ensure the user/tenant record + assigned vaults exist. */
export function onboardHandler(store: Store): KindHandler {
  return {
    steps: (req) => [
      {
        name: 'ensure_user_record',
        ensure: async () => {
          store.upsertUser({
            userId: String(req.payload.userId),
            tenant: req.tenant,
            role: String(req.payload.role ?? 'user'),
            assignedVaults: Array.isArray(req.payload.assignedVaults)
              ? (req.payload.assignedVaults as string[])
              : [],
            mustRotate: false,
            createdAt: new Date().toISOString(),
          });
        },
      },
    ],
  };
}

/** C2 vault create: reconcile the four logical resources. */
export function vaultCreateHandler(infra: VaultInfra): KindHandler {
  return {
    steps: (req) => {
      const ns = String(req.payload.namespace);
      const adapter = String(req.payload.backing_store_adapter ?? 'git-subdir');
      const endpoint = vaultEndpoint(req.payload, ns);
      return [
        { name: 'ensure_git_backing_store', ensure: () => infra.ensureGitBackingStore(ns, adapter) },
        { name: 'ensure_typesense_collection', ensure: () => infra.ensureTypesenseCollection(ns) },
        { name: 'ensure_neo4j_database', ensure: () => infra.ensureNeo4jDatabase(ns) },
        { name: 'ensure_registry_entry', ensure: () => infra.ensureRegistryEntry(ns, endpoint) },
      ];
    },
  };
}

/** C2 vault attach: an existing vault — only the registry mapping is (re)ensured. */
export function vaultAttachHandler(infra: VaultInfra): KindHandler {
  return {
    steps: (req) => {
      const ns = String(req.payload.namespace);
      return [
        {
          name: 'ensure_registry_entry',
          ensure: () => infra.ensureRegistryEntry(ns, vaultEndpoint(req.payload, ns)),
        },
      ];
    },
  };
}

/** Crude teardown: deregister → drop collection → drop db. No export. */
export function vaultDeleteHandler(infra: VaultInfra): KindHandler {
  return {
    steps: (req) => {
      const ns = String(req.payload.namespace);
      return [
        { name: 'deregister', ensure: () => infra.removeRegistryEntry(ns) },
        { name: 'drop_typesense_collection', ensure: () => infra.dropTypesenseCollection(ns) },
        { name: 'drop_neo4j_database', ensure: () => infra.dropNeo4jDatabase(ns) },
      ];
    },
  };
}
