/**
 * `horus operator` — admin CLI for the Control Plane operator-service.
 *
 * operator-service is ClusterIP-only (no ingress); this CLI reaches it via an
 * explicit --operator-url or by auto `kubectl port-forward`. The headline
 * command is `user add`, which onboards a user and emits the pre-provisioned
 * bundle consumed by `horus setup --config <bundle>`.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { execa } from 'execa';
import { buildBundle, serializeBundle, type AssignedVault } from '../lib/bundle.js';

interface GlobalOpts {
  operatorUrl?: string;
  namespace?: string;
  port?: string;
}

interface OperatorClient {
  baseUrl: string;
  close: () => Promise<void>;
}

/** Resolve a base URL to operator-service, auto port-forwarding when none given. */
async function connect(opts: GlobalOpts): Promise<OperatorClient> {
  const explicit = opts.operatorUrl ?? process.env.HORUS_OPERATOR_URL;
  if (explicit) {
    return { baseUrl: explicit.replace(/\/$/, ''), close: async () => {} };
  }
  const localPort = Number(opts.port ?? '8090');
  const ns = opts.namespace ?? 'horus-system';
  const proc = execa(
    'kubectl',
    ['port-forward', 'svc/operator-service', `${localPort}:8090`, '-n', ns],
    { stdio: 'ignore' },
  );
  await new Promise((r) => setTimeout(r, 1500));
  return {
    baseUrl: `http://127.0.0.1:${localPort}`,
    close: async () => {
      proc.kill();
    },
  };
}

async function api<T>(baseUrl: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-operator-role': 'admin', 'x-operator-user': 'admin' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`operator-service ${method} ${path} → ${res.status}: ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** Parse repeatable `--vault owner/ns=https://endpoint` into AssignedVault[]. */
function collectVault(value: string, prev: AssignedVault[]): AssignedVault[] {
  const [namespace, endpoint] = value.split('=');
  if (!namespace || !endpoint) {
    throw new Error(`--vault must be "<owner/ns>=<endpoint>", got "${value}"`);
  }
  return [...prev, { namespace, endpoint }];
}

export const operatorCommand = new Command('operator').description(
  'Control Plane admin: users, vaults, provisioning requests',
);

// ── user ──────────────────────────────────────────────────────────────────
const userCmd = operatorCommand.command('user').description('User management');

userCmd
  .command('add <userId>')
  .description('Onboard a user and emit a pre-provisioned config bundle')
  .requiredOption('--tenant <tenant>', 'tenant the user belongs to')
  .requiredOption('--cp-url <url>', 'public Control Plane URL the client connects to')
  .option('--role <role>', 'user role', 'user')
  .option('--vault <ns=endpoint>', 'assign a vault (repeatable)', collectVault, [])
  .option('--ttl <seconds>', 'initial token lifetime', '86400')
  .option('--out <path>', 'bundle output path')
  .option('--operator-url <url>', 'operator-service base URL (skip port-forward)')
  .option('--namespace <ns>', 'k8s namespace for port-forward', 'horus-system')
  .action(async (userId: string, opts: Record<string, unknown>) => {
    const vaults = opts.vault as AssignedVault[];
    const client = await connect(opts as GlobalOpts);
    try {
      await api(client.baseUrl, 'POST', '/requests', {
        kind: 'onboard',
        tenant: opts.tenant,
        payload: { userId, role: opts.role, assignedVaults: vaults.map((v) => v.namespace) },
      });
      const minted = await api<{ token: string }>(client.baseUrl, 'POST', '/tokens', {
        userId,
        ttlSeconds: Number(opts.ttl),
      });
      const bundle = buildBundle({
        controlPlaneUrl: opts.cpUrl as string,
        initialToken: minted.token,
        vaults,
      });
      const outPath = resolve((opts.out as string) ?? `./${userId}.bundle.yaml`);
      writeFileSync(outPath, serializeBundle(bundle), 'utf8');
      console.log(`Bundle written to ${outPath}`);
      console.log(`Run: horus setup --config ${outPath}`);
    } finally {
      await client.close();
    }
  });

userCmd
  .command('list')
  .description('List users')
  .option('--operator-url <url>', 'operator-service base URL')
  .action(async (opts: GlobalOpts) => {
    const client = await connect(opts);
    try {
      console.log(JSON.stringify(await api(client.baseUrl, 'GET', '/users'), null, 2));
    } finally {
      await client.close();
    }
  });

// ── vault ─────────────────────────────────────────────────────────────────
const vaultCmd = operatorCommand.command('vault').description('Vault provisioning');

function vaultRequest(kind: 'vault_create' | 'vault_attach' | 'vault_delete') {
  return async (opts: Record<string, unknown>) => {
    const client = await connect(opts as GlobalOpts);
    try {
      const out = await api(client.baseUrl, 'POST', '/requests', {
        kind,
        tenant: opts.tenant,
        payload: {
          namespace: opts.namespace,
          target_router: opts.router,
          backing_store_adapter: opts.adapter,
          endpoint: opts.endpoint,
        },
      });
      console.log(JSON.stringify(out, null, 2));
    } finally {
      await client.close();
    }
  };
}

for (const [sub, kind] of [
  ['create', 'vault_create'],
  ['attach', 'vault_attach'],
  ['delete', 'vault_delete'],
] as const) {
  vaultCmd
    .command(`${sub}`)
    .requiredOption('--namespace <owner/ns>', 'vault namespace')
    .requiredOption('--tenant <tenant>', 'tenant')
    .option('--router <name>', 'target router', 'vault-router')
    .option('--adapter <adapter>', 'backing-store adapter', 'git-subdir')
    .option('--endpoint <url>', 'explicit upstream endpoint')
    .option('--operator-url <url>', 'operator-service base URL')
    .action(vaultRequest(kind));
}

/**
 * `horus operator vault adopt` — thin alias for vault_attach that surfaces
 * git backing-store fields (--git-org, --repo-name, --git-api-host).
 *
 * Calls vault_attach with the git_org/repo_name/git_api_host fields included
 * in the payload so ensureRegistryEntry can derive git_repo deterministically
 * (fixing the missing git_repo bug in vault_attach).
 */
vaultCmd
  .command('adopt')
  .description(
    'Register an existing vault in the registry (vault_attach with git backing-store fields)',
  )
  .requiredOption('--namespace <owner/ns>', 'vault namespace')
  .requiredOption('--tenant <tenant>', 'tenant')
  .option('--git-org <org>', 'GitHub org/owner for the backing repo')
  .option('--repo-name <name>', 'backing repo name (default: vault-<slug>)')
  .option('--git-api-host <host>', 'GitHub API hostname override (for GitHub Enterprise)')
  .option('--router <name>', 'target router', 'vault-router')
  .option('--endpoint <url>', 'explicit upstream endpoint')
  .option('--adapter <adapter>', 'backing-store adapter', 'git-subdir')
  .option('--operator-url <url>', 'operator-service base URL')
  .action(async (opts: Record<string, unknown>) => {
    const client = await connect(opts as GlobalOpts);
    try {
      const out = await api(client.baseUrl, 'POST', '/requests', {
        kind: 'vault_attach',
        tenant: opts.tenant,
        payload: {
          namespace: opts.namespace,
          target_router: opts.router,
          backing_store_adapter: opts.adapter,
          endpoint: opts.endpoint,
          git_org: opts.gitOrg,
          repo_name: opts.repoName,
          git_api_host: opts.gitApiHost,
        },
      });
      console.log(JSON.stringify(out, null, 2));
    } finally {
      await client.close();
    }
  });

// ── request ─────────────────────────────────────────────────────────────────
const reqCmd = operatorCommand.command('request').description('Provisioning requests');

reqCmd
  .command('list')
  .option('--operator-url <url>', 'operator-service base URL')
  .action(async (opts: GlobalOpts) => {
    const client = await connect(opts);
    try {
      console.log(JSON.stringify(await api(client.baseUrl, 'GET', '/requests'), null, 2));
    } finally {
      await client.close();
    }
  });

reqCmd
  .command('show <id>')
  .option('--operator-url <url>', 'operator-service base URL')
  .action(async (id: string, opts: GlobalOpts) => {
    const client = await connect(opts);
    try {
      console.log(JSON.stringify(await api(client.baseUrl, 'GET', `/requests/${id}`), null, 2));
    } finally {
      await client.close();
    }
  });

for (const decision of ['approve', 'reject'] as const) {
  reqCmd
    .command(`${decision} <id>`)
    .option('--operator-url <url>', 'operator-service base URL')
    .action(async (id: string, opts: GlobalOpts) => {
      const client = await connect(opts);
      try {
        console.log(
          JSON.stringify(await api(client.baseUrl, 'POST', `/requests/${id}/${decision}`), null, 2),
        );
      } finally {
        await client.close();
      }
    });
}

// ── login (forced bootstrap-admin rotation) ─────────────────────────────────
operatorCommand
  .command('login')
  .description('Authenticate; forces bootstrap-admin credential rotation on first login (§H)')
  .option('--admin <id>', 'admin user id', 'admin')
  .option('--operator-url <url>', 'operator-service base URL')
  .action(async (opts: GlobalOpts & { admin?: string }) => {
    const client = await connect(opts);
    try {
      const adminId = opts.admin ?? 'admin';
      const users = await api<Array<{ userId: string; mustRotate: boolean }>>(
        client.baseUrl,
        'GET',
        '/users',
      );
      const admin = users.find((u) => u.userId === adminId);
      if (admin?.mustRotate) {
        await api(client.baseUrl, 'POST', '/admin/rotate', { adminId });
        console.log('Bootstrap admin credential rotated (forced on first login).');
      } else {
        console.log('Logged in. No rotation required.');
      }
    } finally {
      await client.close();
    }
  });

// ── init (principal/secret wiring) ───────────────────────────────────────────

interface PrincipalBundle {
  clientJwks: Array<{ kid: string; publicJwk: Record<string, unknown> }>;
  internalSigningKey: { kid: string; alg: string; privateJwk: Record<string, unknown> };
  internalPublicJwk: Record<string, unknown>;
}

/** Render the two principal Secrets as a kubectl-appliable manifest. JSON values
 *  are single-quoted YAML scalars (JSON never contains single quotes). */
function renderPrincipalSecrets(namespace: string, b: PrincipalBundle): string {
  const clientJwks = JSON.stringify(b.clientJwks);
  const internalSigningKey = JSON.stringify(b.internalSigningKey);
  const pubJwk = JSON.stringify(b.internalPublicJwk);
  return `apiVersion: v1
kind: Secret
metadata:
  name: horus-service-secrets
  namespace: ${namespace}
type: Opaque
stringData:
  HORUS_CLIENT_JWKS_JSON: '${clientJwks}'
  HORUS_INTERNAL_SIGNING_KEY_JSON: '${internalSigningKey}'
---
apiVersion: v1
kind: Secret
metadata:
  name: horus-principal-pub
  namespace: ${namespace}
type: Opaque
stringData:
  pub.jwk: '${pubJwk}'
`;
}

operatorCommand
  .command('init')
  .description(
    'Derive horus-service-secrets + horus-principal-pub from operator-service keys and apply them',
  )
  .option('--namespace <ns>', 'k8s namespace', 'horus-system')
  .option('--operator-url <url>', 'operator-service base URL (skip port-forward)')
  .option('--port <port>', 'local port for port-forward', '8090')
  .option('--dry-run', 'print the Secret manifests instead of applying', false)
  .option('--out <path>', 'write the Secret manifests to a file instead of applying')
  .action(async (opts: GlobalOpts & { dryRun?: boolean; out?: string }) => {
    const client = await connect(opts);
    try {
      const bundle = await api<PrincipalBundle>(client.baseUrl, 'GET', '/admin/principal-bundle');
      const ns = opts.namespace ?? 'horus-system';
      const manifests = renderPrincipalSecrets(ns, bundle);
      if (opts.out) {
        writeFileSync(resolve(opts.out), manifests, 'utf8');
        console.log(`Principal Secrets written to ${resolve(opts.out)}`);
        return;
      }
      if (opts.dryRun) {
        process.stdout.write(manifests);
        return;
      }
      await execa('kubectl', ['apply', '-n', ns, '-f', '-'], {
        input: manifests,
        stdio: ['pipe', 'inherit', 'inherit'],
      });
      console.log(`Applied horus-service-secrets + horus-principal-pub to namespace ${ns}.`);
      console.log('horus-service can now mint X-Horus-Principal; Vault and forge-registry can verify it.');
    } finally {
      await client.close();
    }
  });

// ── status ──────────────────────────────────────────────────────────────────
operatorCommand
  .command('status')
  .option('--operator-url <url>', 'operator-service base URL')
  .action(async (opts: GlobalOpts) => {
    const client = await connect(opts);
    try {
      const health = await api(client.baseUrl, 'GET', '/health');
      const requests = await api<unknown[]>(client.baseUrl, 'GET', '/requests');
      const users = await api<unknown[]>(client.baseUrl, 'GET', '/users');
      console.log(
        JSON.stringify({ health, requests: requests.length, users: users.length }, null, 2),
      );
    } finally {
      await client.close();
    }
  });
