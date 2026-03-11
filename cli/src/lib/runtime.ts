import { execa, type ExecaReturnValue } from 'execa';
import { HORUS_DIR } from './constants.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface Runtime {
  name: 'docker' | 'podman';
  compose(...args: string[]): Promise<ExecResult>;
  exec(container: string, ...cmd: string[]): Promise<ExecResult>;
  inspect(container: string, format: string): Promise<string>;
  isRunning(): Promise<boolean>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function toResult(result: ExecaReturnValue): ExecResult {
  return {
    stdout: result.stdout?.toString() ?? '',
    stderr: result.stderr?.toString() ?? '',
    exitCode: result.exitCode ?? 0,
  };
}

async function tryCommand(command: string, args: string[]): Promise<boolean> {
  try {
    const result = await execa(command, args, { reject: false });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execa(command, ['--version'], { reject: false });
    return true;
  } catch {
    return false;
  }
}

// ── Runtime implementation ──────────────────────────────────────────────────

function createRuntime(name: 'docker' | 'podman'): Runtime {
  const bin = name;
  // Pass HORUS_RUNTIME to compose so entrypoints can detect docker vs podman
  const composeEnv = { ...process.env, HORUS_RUNTIME: name };

  return {
    name,

    async compose(...args: string[]): Promise<ExecResult> {
      const result = await execa(bin, ['compose', ...args], {
        cwd: HORUS_DIR,
        env: composeEnv,
        reject: false,
      });
      if (result.exitCode !== 0) {
        const error = new Error(
          `${bin} compose ${args.join(' ')} failed (exit ${result.exitCode}): ${result.stderr}`
        );
        (error as any).result = toResult(result);
        throw error;
      }
      return toResult(result);
    },

    async exec(container: string, ...cmd: string[]): Promise<ExecResult> {
      const result = await execa(bin, ['exec', container, ...cmd], {
        reject: false,
      });
      return toResult(result);
    },

    async inspect(container: string, format: string): Promise<string> {
      const result = await execa(bin, ['inspect', '--format', format, container], {
        reject: false,
      });
      return result.stdout?.toString().trim() ?? '';
    },

    async isRunning(): Promise<boolean> {
      try {
        const result = await execa(bin, ['compose', 'ps', '--format', 'json'], {
          cwd: HORUS_DIR,
          env: composeEnv,
          reject: false,
        });
        return result.exitCode === 0 && result.stdout.toString().trim().length > 0;
      } catch {
        return false;
      }
    },
  };
}

// ── Detection ───────────────────────────────────────────────────────────────

/**
 * Check whether a specific runtime is installed and has the compose plugin.
 */
export async function checkRuntime(name: 'docker' | 'podman'): Promise<boolean> {
  return tryCommand(name, ['compose', 'version']);
}

/**
 * Auto-detect available container runtime.
 * Checks Docker first, then Podman.
 * Throws if neither is available.
 */
export async function detectRuntime(preferred?: 'docker' | 'podman'): Promise<Runtime> {
  // If a preference is given, try that first
  if (preferred) {
    const hasPreferred = await tryCommand(preferred, ['compose', 'version']);
    if (hasPreferred) {
      return createRuntime(preferred);
    }
  }

  // Try Docker
  const hasDocker = await tryCommand('docker', ['compose', 'version']);
  if (hasDocker) {
    return createRuntime('docker');
  }

  // Try Podman
  const hasPodman = await tryCommand('podman', ['compose', 'version']);
  if (hasPodman) {
    return createRuntime('podman');
  }

  // Check if Podman is installed but its compose subcommand is broken — give a targeted error.
  const podmanInstalled = await commandExists('podman');
  if (podmanInstalled) {
    throw new Error(
      'Podman is installed but `podman compose` is not working.\n\n' +
        'Fix options:\n' +
        '  1. Ensure your Podman machine is running:  podman machine start\n' +
        '  2. Install podman-compose:                 pip3 install podman-compose\n' +
        '  3. Upgrade Podman to v5+:                  brew upgrade podman\n'
    );
  }

  throw new Error(
    'No container runtime found.\n\n' +
      'Horus requires Docker or Podman with the Compose plugin.\n\n' +
      'Install one of:\n' +
      '  - Docker Desktop: https://www.docker.com/products/docker-desktop/\n' +
      '  - Podman Desktop:  https://podman-desktop.io/\n'
  );
}

/**
 * Log the runtime into a container registry using a token.
 * Returns true on success, false on failure.
 */
export async function registryLogin(
  runtime: Runtime,
  registry: string,
  token: string,
  username = 'horus',
): Promise<boolean> {
  const result = await execa(runtime.name, ['login', registry, '-u', username, '--password-stdin'], {
    input: token,
    reject: false,
  });
  return result.exitCode === 0;
}

/**
 * Run a compose command with output streamed to the terminal (inherits stdio).
 * Used for operations where the user should see real-time progress (e.g., pull, up).
 */
export async function composeStreaming(
  runtime: Runtime,
  args: string[]
): Promise<void> {
  const bin = runtime.name;
  const result = await execa(bin, ['compose', ...args], {
    cwd: HORUS_DIR,
    env: { ...process.env, HORUS_RUNTIME: runtime.name },
    stdio: 'inherit',
    reject: false,
  });
  if (result.exitCode !== 0) {
    throw new Error(`${bin} compose ${args.join(' ')} failed with exit code ${result.exitCode}`);
  }
}
