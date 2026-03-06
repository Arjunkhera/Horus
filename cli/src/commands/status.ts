import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { configExists, loadConfig } from '../lib/config.js';
import { detectRuntime } from '../lib/runtime.js';
import { composeFileExists } from '../lib/compose.js';
import { SERVICES } from '../lib/constants.js';

// ── Types ───────────────────────────────────────────────────────────────────

interface ContainerInfo {
  Name: string;
  Service: string;
  State: string;
  Status: string;
  Health: string;
  Publishers?: Array<{
    PublishedPort: number;
    TargetPort: number;
    Protocol: string;
  }>;
}

// ── Status command ──────────────────────────────────────────────────────────

export const statusCommand = new Command('status')
  .description('Show status of Horus services')
  .action(async () => {
    // Check that setup has been run
    if (!configExists() || !composeFileExists()) {
      console.log(chalk.red('Horus is not set up yet.'));
      console.log(chalk.dim('Run `horus setup` first.'));
      process.exit(1);
    }

    const config = loadConfig();

    // Detect runtime
    const spinner = ora('Checking services...').start();
    let runtime;
    try {
      runtime = await detectRuntime(config.runtime);
    } catch (error) {
      spinner.fail('No container runtime found');
      console.log((error as Error).message);
      process.exit(1);
      return;
    }

    // Get compose ps output
    let containers: ContainerInfo[] = [];
    try {
      const result = await runtime.compose('ps', '--format', 'json');
      const output = result.stdout.trim();
      if (output) {
        // Docker compose outputs one JSON object per line (not a JSON array)
        containers = output
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line) as ContainerInfo);
      }
    } catch {
      // Stack may not be running
    }
    spinner.stop();

    // Display header
    console.log('');
    console.log(chalk.bold('Horus Status'));
    console.log(chalk.dim('──────────────────────────────────────'));
    console.log(`  ${chalk.bold('Version:')}  ${config.version}`);
    console.log(`  ${chalk.bold('Runtime:')}  ${runtime.name}`);
    console.log(`  ${chalk.bold('Config:')}   ~/.horus/config.yaml`);
    console.log('');

    if (containers.length === 0) {
      console.log(chalk.yellow('  No services are running.'));
      console.log(chalk.dim('  Run `horus up` to start the stack.'));
      console.log('');
      return;
    }

    // Build the status table
    const header = `  ${pad('SERVICE', 14)} ${pad('STATUS', 12)} ${pad('PORTS', 20)} ${pad('UPTIME', 20)}`;
    console.log(chalk.bold(header));
    console.log(chalk.dim('  ' + '─'.repeat(66)));

    for (const service of SERVICES) {
      const container = containers.find(
        (c) => c.Service === service || c.Name?.includes(service)
      );

      if (!container) {
        console.log(
          `  ${pad(service, 14)} ${chalk.red(pad('stopped', 12))} ${pad('-', 20)} ${pad('-', 20)}`
        );
        continue;
      }

      // Determine status color
      const healthStatus = container.Health || container.State || 'unknown';
      const statusColor = getStatusColor(healthStatus);
      const displayStatus = statusColor(pad(healthStatus, 12));

      // Format ports
      const ports = formatPorts(container.Publishers);

      // Extract uptime from Status field (e.g., "Up 2 hours (healthy)")
      const uptime = extractUptime(container.Status);

      console.log(`  ${pad(service, 14)} ${displayStatus} ${pad(ports, 20)} ${pad(uptime, 20)}`);
    }

    console.log('');
  });

// ── Helpers ─────────────────────────────────────────────────────────────────

function pad(str: string, width: number): string {
  return str.padEnd(width);
}

function getStatusColor(status: string): (s: string) => string {
  const lower = status.toLowerCase();
  if (lower === 'healthy' || lower === 'running') return chalk.green;
  if (lower === 'starting') return chalk.yellow;
  return chalk.red;
}

function formatPorts(publishers?: Array<{ PublishedPort: number; TargetPort: number }>): string {
  if (!publishers || publishers.length === 0) return '-';
  const mapped = publishers
    .filter((p) => p.PublishedPort > 0)
    .map((p) => `${p.PublishedPort}:${p.TargetPort}`)
    .filter((v, i, a) => a.indexOf(v) === i); // dedupe
  return mapped.length > 0 ? mapped.join(', ') : '-';
}

function extractUptime(status: string): string {
  if (!status) return '-';
  // Status is like "Up 2 hours (healthy)" or "Exited (0) 3 minutes ago"
  const match = status.match(/^Up\s+(.+?)(?:\s*\(.*\))?$/i);
  if (match) return match[1].trim();
  return status;
}
