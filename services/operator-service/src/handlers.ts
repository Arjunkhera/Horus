/** Per-kind provisioning handlers (MVP: onboard, vault create/attach/delete). */

import type { KindHandler } from './provisioner.js';
import type { VaultInfra } from './infra.js';
import { InMemoryCollisionError } from './infra.js';
import type { Store } from './store.js';

/** GitHub-safe string pattern: org names, repo names. */
const GITHUB_SAFE_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Validates that a string is a reasonable GitHub org or repo name.
 * Returns null on valid input; an error message on invalid.
 */
function validateGithubName(value: string, fieldName: string): string | null {
  if (!GITHUB_SAFE_RE.test(value)) {
    return (
      `Invalid ${fieldName} "${value}": must match ^[A-Za-z0-9._-]+$ ` +
      `(GitHub org/repo names may only contain alphanumeric characters, hyphens, underscores, and dots).`
    );
  }
  return null;
}

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

/**
 * C2 vault create: reconcile the four logical resources.
 *
 * Steps (in order):
 *   1. check_namespace_collision — NAMESPACE_EXISTS pre-flight: reads the registry
 *      and throws if the namespace is already provisioned (fails fast as 409).
 *      The Provisioner's steps ledger ensures this step only runs on the FIRST
 *      attempt; retries skip it (step marked done), so false-collision on retry
 *      is impossible.
 *   2. ensure_git_backing_store
 *   3. ensure_typesense_collection
 *   4. ensure_neo4j_database
 *   5. ensure_registry_entry
 *
 * Optional payload fields (P2):
 *   - git_org   {string} — GitHub org/owner for the repo. Default: GITHUB_OWNER env.
 *   - repo_name {string} — repo name. Default: `vault-<namespaceSlug(namespace)>`.
 *
 * Both must match ^[A-Za-z0-9._-]+$ (GitHub-safe). An invalid value causes the
 * `ensure_git_backing_store` step to fail with a clear error message.
 */
export function vaultCreateHandler(infra: VaultInfra): KindHandler {
  return {
    steps: (req) => {
      const ns = String(req.payload.namespace);
      const adapter = String(req.payload.backing_store_adapter ?? 'git-subdir');
      const endpoint = vaultEndpoint(req.payload, ns);

      // Resolve optional git_org / repo_name from payload.
      const rawGitOrg = req.payload.git_org;
      const rawRepoName = req.payload.repo_name;
      const gitOrg = rawGitOrg != null ? String(rawGitOrg) : undefined;
      const repoName = rawRepoName != null ? String(rawRepoName) : undefined;

      const gitOpts = (gitOrg !== undefined || repoName !== undefined)
        ? { gitOrg, repoName }
        : undefined;

      return [
        {
          /**
           * NAMESPACE_EXISTS pre-flight.
           *
           * This step is marked done in the Provisioner's steps ledger on success,
           * so a `POST /requests/:id/retry` of the SAME request will skip it —
           * guaranteeing no false-collision on legitimate retries.
           *
           * Only namespaces owned by a DIFFERENT completed request will fail here.
           */
          name: 'check_namespace_collision',
          ensure: async () => {
            const registered = await infra.isNamespaceRegistered(ns);
            if (registered) {
              throw new InMemoryCollisionError(
                'NAMESPACE_EXISTS',
                `Namespace "${ns}" is already registered in the vault-registry. ` +
                  `Use a different namespace or delete the existing vault first.`,
                { namespace: ns },
              );
            }
          },
        },
        {
          name: 'ensure_git_backing_store',
          ensure: async () => {
            // Validate git_org / repo_name here (inside ensure, so errors are
            // caught by the Provisioner and stored in req.error as 'failed').
            if (gitOrg !== undefined) {
              const err = validateGithubName(gitOrg, 'git_org');
              if (err) throw new Error(err);
            }
            if (repoName !== undefined) {
              const err = validateGithubName(repoName, 'repo_name');
              if (err) throw new Error(err);
            }
            return infra.ensureGitBackingStore(ns, adapter, gitOpts);
          },
        },
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
