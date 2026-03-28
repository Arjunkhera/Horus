import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { existsSync, accessSync, statfsSync, constants } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, configExists } from '../lib/config.js';
import { detectRuntime, parseComposeJson } from '../lib/runtime.js';
import { COMPOSE_PATH, DEFAULT_PORTS, DEFAULT_DATA_DIR, HEALTH_ENDPOINTS } from '../lib/constants.js';

// ── Types ─────────────────────────────────────────────────────────────────────

type CheckStatus = 'pass' | 'warn' | 'fail';

interface CheckResult {
  status: CheckStatus;
  label: string;
  message: string;
  hint?: string;
}

// ── Symbols ───────────────────────────────────────────────────────────────────

function symbol(status: CheckStatus): string {
  switch (status) {
    case 'pass':
      return chalk.green('  ✓ ');
    case 'warn':
      return chalk.yellow('  ⚠ ');
    case 'fail':
      return chalk.red('  ✗ ');
  }
}

function colorMessage(status: CheckStatus, msg: string): string {
  switch (status) {
    case 'pass':
      return chalk.white(msg);
    case 'warn':
      return chalk.yellow(msg);
    case 'fail':
      return chalk.red(msg);
  }
}

// ── Individual checks ─────────────────────────────────────────────────────────

async function checkRuntimeAvailability(preferred?: 'docker' | 'podman'): Promise<CheckResult> {
  // Check the preferred runtime first, then the other
  const order: Array<'docker' | 'podman'> = preferred === 'podman'
    ? ['podman', 'docker']
    : ['docker', 'podman'];

  for (const rt of order) {
    try {
      execSync(`${rt} info`, { stdio: 'ignore' });
      return { status: 'pass', label: 'Runtime', message: `${rt === 'docker' ? 'Docker' : 'Podman'} is running` };
    } catch {
      // Try next
    }
  }

  return {
    status: 'fail',
    label: 'Runtime',
    message: 'Docker/Podman is not running',
    hint: 'Start Docker Desktop or Podman Desktop',
  };
}

async function checkCompose(preferred?: 'docker' | 'podman'): Promise<CheckResult> {
  const order: Array<'docker' | 'podman'> = preferred === 'podman'
    ? ['podman', 'docker']
    : ['docker', 'podman'];

  for (const rt of order) {
    try {
      execSync(`${rt} compose version`, { stdio: 'ignore' });
      const label = rt === 'podman' ? 'Compose plugin available (podman)' : 'Compose plugin available';
      return { status: 'pass', label: 'Compose', message: label };
    } catch {
      // Try next
    }
  }

  return {
    status: 'fail',
    label: 'Compose',
    message: 'Compose plugin not found',
    hint: 'Install Docker Compose plugin or podman-compose',
  };
}

function checkConfig(): CheckResult {
  if (configExists()) {
    return { status: 'pass', label: 'Config', message: 'Configuration file exists (~/Horus/config.yaml)' };
  }
  return {
    status: 'fail',
    label: 'Config',
    message: 'Configuration file missing (~/Horus/config.yaml)',
    hint: 'Run `horus setup` to create the configuration',
  };
}

function checkComposeFile(): CheckResult {
  if (existsSync(COMPOSE_PATH)) {
    return { status: 'pass', label: 'Compose file', message: 'Compose file installed (~/Horus/docker-compose.yml)' };
  }
  return {
    status: 'fail',
    label: 'Compose file',
    message: 'Compose file missing (~/Horus/docker-compose.yml)',
    hint: 'Run `horus setup` to install the compose file',
  };
}

function checkPort(port: number, serviceName: string): CheckResult {
  try {
    // lsof -i :<port> -sTCP:LISTEN -t returns PIDs listening on that port
    const output = execSync(`lsof -i :${port} -sTCP:LISTEN -t 2>/dev/null || true`, {
      encoding: 'utf-8',
    }).trim();

    if (!output) {
      return { status: 'pass', label: `Port ${port}`, message: `Port ${port} is free (${serviceName})` };
    }

    // Check if it's a Horus container holding the port
    const pids = output.split('\n').filter(Boolean);
    for (const pid of pids) {
      try {
        const cmdline = execSync(`ps -p ${pid} -o comm= 2>/dev/null || true`, {
          encoding: 'utf-8',
        }).trim();
        if (cmdline.toLowerCase().includes('docker') || cmdline.toLowerCase().includes('podman')) {
          // Likely held by Horus containers
          return { status: 'pass', label: `Port ${port}`, message: `Port ${port} in use by Horus (${serviceName})` };
        }
      } catch {
        // ignore
      }
    }

    return {
      status: 'warn',
      label: `Port ${port}`,
      message: `Port ${port} in use by another process (${serviceName} needs port ${port})`,
      hint: `Change the port with \`horus config set port.${serviceName.toLowerCase()} <port>\``,
    };
  } catch {
    return { status: 'pass', label: `Port ${port}`, message: `Port ${port} status unknown` };
  }
}

function checkDataDir(dataDir: string): CheckResult {
  if (!existsSync(dataDir)) {
    return {
      status: 'warn',
      label: 'Data directory',
      message: `Data directory does not exist: ${dataDir}`,
      hint: 'It will be created automatically when Horus starts',
    };
  }
  try {
    accessSync(dataDir, constants.W_OK);
    return { status: 'pass', label: 'Data directory', message: `Data directory exists and is writable (${dataDir})` };
  } catch {
    return {
      status: 'fail',
      label: 'Data directory',
      message: `Data directory is not writable: ${dataDir}`,
      hint: `Run: chmod u+w "${dataDir}"`,
    };
  }
}

function checkDiskSpace(dataDir: string): CheckResult {
  const checkDir = existsSync(dataDir) ? dataDir : join(dataDir, '..');
  try {
    const stats = statfsSync(checkDir);
    const freeBytes = stats.bfree * stats.bsize;
    const freeGB = freeBytes / (1024 ** 3);
    const freeGBStr = freeGB.toFixed(1);
    const MIN_GB = 5;

    if (freeGB >= MIN_GB) {
      return { status: 'pass', label: 'Disk space', message: `Disk space: ${freeGBStr}GB available` };
    }
    return {
      status: 'warn',
      label: 'Disk space',
      message: `Disk space low: only ${freeGBStr}GB available (5GB recommended)`,
      hint: 'Free up disk space before running Horus',
    };
  } catch {
    return { status: 'warn', label: 'Disk space', message: 'Could not check available disk space' };
  }
}

async function checkServices(runtime: Awaited<ReturnType<typeof detectRuntime>>): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  try {
    const psResult = await runtime.compose('ps', '--format', 'json');

    interface ContainerPs {
      Service?: string;
      State?: string;
      Health?: string;
    }

    const containers = parseComposeJson<ContainerPs>(psResult.stdout);

    if (containers.length === 0) {
      return [
        {
          status: 'warn',
          label: 'Services',
          message: 'No services are running',
          hint: 'Run `horus up` to start the stack',
        },
      ];
    }

    for (const c of containers) {
      const name = c.Service ?? (c as any).Name ?? 'unknown';
      const health = (c.Health || c.State || 'unknown').toLowerCase();
      if (health === 'healthy' || health === 'running' || health === 'up') {
        results.push({ status: 'pass', label: `Service: ${name}`, message: `${name} is ${health}` });
      } else if (health === 'starting') {
        results.push({
          status: 'warn',
          label: `Service: ${name}`,
          message: `${name} is still starting`,
          hint: 'Wait a moment and re-run `horus doctor`',
        });
      } else {
        results.push({
          status: 'fail',
          label: `Service: ${name}`,
          message: `${name} service is ${health}`,
          hint: `Run: horus logs ${name}`,
        });
      }
    }
  } catch {
    results.push({
      status: 'warn',
      label: 'Services',
      message: 'Could not check service status (stack may not be running)',
      hint: 'Run `horus up` to start the stack',
    });
  }
  return results;
}


// ── Sync health check ─────────────────────────────────────────────────────────
// Fetches /health from a service and surfaces sync degradation as a check result.
// Only anvil and forge have git sync daemons.
async function checkSyncHealth(
  serviceName: 'anvil' | 'forge',
  ports: typeof DEFAULT_PORTS
): Promise<CheckResult> {
  const portMap = { anvil: ports.anvil, forge: ports.forge };
  const port = portMap[serviceName];
  const url = `http://localhost:${port}/health`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const body = await resp.json() as Record<string, unknown>;
    const sync = body.sync as Record<string, unknown> | undefined;

    if (resp.status === 503 || body.status === 'degraded') {
      const failures = sync?.consecutive_failures ?? '?';
      const lastError = typeof sync?.last_error === 'string' ? sync.last_error : 'unknown';
      const ahead = sync?.ahead ?? '?';
      const behind = sync?.behind ?? '?';
      return {
        status: 'fail',
        label: `Sync: ${serviceName}`,
        message: `${serviceName} git sync is stuck (${failures} consecutive failures, ${ahead} ahead / ${behind} behind): ${lastError}`,
        hint: `Run: horus logs ${serviceName}  — or manually: cd ~/Horus/data/${serviceName === 'forge' ? 'registry' : 'notes'} && git reset --hard origin/master`,
      };
    }
    if (sync && sync.ok === false) {
      const failures = sync.consecutive_failures ?? 1;
      return {
        status: 'warn',
        label: `Sync: ${serviceName}`,
        message: `${serviceName} git sync had a recent failure (${failures} consecutive) — not yet stuck`,
        hint: `Run: horus logs ${serviceName}`,
      };
    }
    return { status: 'pass', label: `Sync: ${serviceName}`, message: `${serviceName} git sync healthy` };
  } catch {
    return {
      status: 'warn',
      label: `Sync: ${serviceName}`,
      message: `${serviceName} health endpoint not reachable — sync status unknown`,
      hint: 'Service may not be running',
    };
  }
}

// ── Doctor command ────────────────────────────────────────────────────────────

export const doctorCommand = new Command('doctor')
  .description('Diagnose common Horus issues')
  .action(async () => {
    console.log('');
    console.log(chalk.bold('Horus Doctor'));
    console.log(chalk.dim('──────────────────────────────────────'));

    const allResults: CheckResult[] = [];

    // Load config early to know preferred runtime
    const config = configExists() ? loadConfig() : null;

    // 1. Runtime
    allResults.push(await checkRuntimeAvailability(config?.runtime));

    // 2. Compose
    allResults.push(await checkCompose(config?.runtime));

    // 3. Config
    allResults.push(checkConfig());

    // 4. Compose file
    allResults.push(checkComposeFile());

    const ports = config?.ports ?? DEFAULT_PORTS;
    const dataDir = config?.data_dir ?? DEFAULT_DATA_DIR;

    // 5. Ports
    allResults.push(checkPort(ports.anvil, 'Anvil'));
    allResults.push(checkPort(ports.vault_rest, 'Vault'));
    allResults.push(checkPort(ports.vault_mcp, 'Vault MCP'));
    allResults.push(checkPort(ports.forge, 'Forge'));

    // 6. Data directory
    allResults.push(checkDataDir(dataDir));

    // 7. Disk space
    allResults.push(checkDiskSpace(dataDir));

    // 8. Services (only if runtime + compose are ok)
    const runtimeOk = allResults[0].status !== 'fail';
    const composeOk = allResults[1].status !== 'fail';
    if (runtimeOk && composeOk) {
      try {
        const runtime = await detectRuntime(config?.runtime);
        const serviceResults = await checkServices(runtime);
        allResults.push(...serviceResults);
      } catch {
        allResults.push({
          status: 'warn',
          label: 'Services',
          message: 'Could not detect runtime to check services',
        });
      }
    }

    // 9. Git sync health — anvil notes repo and forge registry
    const ports = config?.ports ?? DEFAULT_PORTS;
    const [anvilSync, forgeSync] = await Promise.all([
      checkSyncHealth('anvil', ports),
      checkSyncHealth('forge', ports),
    ]);
    allResults.push(anvilSync, forgeSync);

    // Print results
    for (const result of allResults) {
      console.log(`${symbol(result.status)}${colorMessage(result.status, result.message)}`);
    }

    // Summary
    const errors = allResults.filter((r) => r.status === 'fail');
    const warnings = allResults.filter((r) => r.status === 'warn');

    console.log(chalk.dim('──────────────────────────────────────'));

    if (errors.length === 0 && warnings.length === 0) {
      console.log(chalk.green('  All checks passed.'));
    } else {
      const parts: string[] = [];
      if (errors.length > 0) parts.push(chalk.red(`${errors.length} error${errors.length > 1 ? 's' : ''}`));
      if (warnings.length > 0) parts.push(chalk.yellow(`${warnings.length} warning${warnings.length > 1 ? 's' : ''}`));
      console.log(`  ${parts.join(', ')}`);

      // Print hints for failures first, then warnings
      const withHints = [...errors, ...warnings].filter((r) => r.hint);
      if (withHints.length > 0) {
        console.log('');
        for (const r of withHints) {
          const icon = r.status === 'fail' ? chalk.red('✗') : chalk.yellow('⚠');
          console.log(`  ${icon} ${chalk.dim(r.hint)}`);
        }
      }
    }

    console.log('');

    // Exit with non-zero if errors
    if (errors.length > 0) {
      process.exit(1);
    }
  });
