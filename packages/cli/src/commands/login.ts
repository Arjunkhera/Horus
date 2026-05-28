import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, configExists, type Config } from '../lib/config.js';

export interface LoginResult {
  ok: boolean;
  /** True when login could not complete now but can be retried later. */
  deferred: boolean;
  message: string;
}

/**
 * Authenticate the client against the configured control plane.
 *
 * This is intentionally thin for the alpha client: the control-plane auth
 * handshake (interactive/OIDC token exchange) is delivered by the control
 * plane (Seq 2). Here we resolve the cases the client can settle on its own
 * and defer the rest non-fatally, so `horus setup` never blocks on login.
 */
export async function runLogin(config: Config): Promise<LoginResult> {
  const cp = (config.control_plane_url ?? '').trim();
  if (!cp) {
    return { ok: true, deferred: false, message: 'Local-only mode — no control plane to log into.' };
  }

  // Soft reachability check — never fatal.
  let reachable = false;
  try {
    const res = await fetch(cp.replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(8_000) });
    reachable = res.ok;
  } catch {
    reachable = false;
  }
  if (!reachable) {
    return {
      ok: false,
      deferred: true,
      message: `Control plane at ${cp} is not reachable yet. Run \`horus login\` once it is available.`,
    };
  }

  const kind = config.token_provider?.kind ?? '';
  if (kind === 'static') {
    const hasToken = !!(config.token_provider?.config ?? '').trim();
    return hasToken
      ? { ok: true, deferred: false, message: 'Static principal token configured — client is authenticated.' }
      : {
          ok: false,
          deferred: true,
          message: 'Static token provider selected but no token is set. Run `horus config set token-provider-config <token>`.',
        };
  }

  // oidc / unconfigured flows complete against the control plane (Seq 2).
  return {
    ok: false,
    deferred: true,
    message: `Interactive login (${kind || 'unconfigured'}) completes against the control plane. Run \`horus login\` once it is available.`,
  };
}

export const loginCommand = new Command('login')
  .description('Authenticate the client against the configured control plane')
  .action(async () => {
    if (!configExists()) {
      console.log(chalk.red('Horus is not configured yet. Run `horus setup` first.'));
      process.exit(1);
    }
    const result = await runLogin(loadConfig());
    if (result.ok) {
      console.log(chalk.green(result.message));
    } else {
      console.log(chalk.yellow(result.message));
    }
  });
