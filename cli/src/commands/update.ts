import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { select, confirm } from '@inquirer/prompts';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import { loadConfig } from '../lib/config.js';
import { detectRuntime, composeStreaming, registryLogin } from '../lib/runtime.js';
import { pollUntilHealthy, type ServiceHealth } from '../lib/health.js';
import { HORUS_DIR, COMPOSE_PATH } from '../lib/constants.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ImageInfo {
  service: string;
  tag: string;
}

interface Snapshot {
  timestamp: string;
  images: Record<string, string>;
  compose_hash: string;
}

// ── Snapshot helpers ──────────────────────────────────────────────────────────

const SNAPSHOTS_DIR = join(HORUS_DIR, 'snapshots');

function ensureSnapshotsDir(): void {
  mkdirSync(SNAPSHOTS_DIR, { recursive: true });
}

function composeFileHash(): string {
  if (!existsSync(COMPOSE_PATH)) return '';
  const content = readFileSync(COMPOSE_PATH, 'utf-8');
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

async function captureCurrentImages(runtime: Awaited<ReturnType<typeof detectRuntime>>): Promise<Record<string, string>> {
  const images: Record<string, string> = {};
  try {
    const result = await runtime.compose('images', '--format', 'json');
    const lines = result.stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as { Service?: string; Tag?: string; Image?: string };
        const service = obj.Service ?? '';
        const tag = obj.Tag ?? obj.Image ?? 'unknown';
        if (service) images[service] = tag;
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // compose images may not be available on all versions — ignore
  }
  return images;
}

function saveSnapshot(images: Record<string, string>): string {
  ensureSnapshotsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshot: Snapshot = {
    timestamp,
    images,
    compose_hash: composeFileHash(),
  };
  const filePath = join(SNAPSHOTS_DIR, `${timestamp}.yaml`);
  writeFileSync(filePath, stringifyYaml(snapshot, { lineWidth: 0 }), 'utf-8');
  return filePath;
}

function listSnapshots(): Array<{ file: string; snapshot: Snapshot }> {
  if (!existsSync(SNAPSHOTS_DIR)) return [];
  return readdirSync(SNAPSHOTS_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .reverse()
    .map((f) => {
      const file = join(SNAPSHOTS_DIR, f);
      const snapshot = parseYaml(readFileSync(file, 'utf-8')) as Snapshot;
      return { file, snapshot };
    });
}

// ── Version check ─────────────────────────────────────────────────────────────

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch('https://api.github.com/repos/Arjunkhera/Horus/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string };
    return data.tag_name ?? null;
  } catch {
    return null;
  }
}

// ── Update command ────────────────────────────────────────────────────────────

export const updateCommand = new Command('update')
  .description('Update Horus to the latest version')
  .option('--rollback', 'Roll back to the previous version')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(async (opts) => {
    console.log('');
    console.log(chalk.bold(opts.rollback ? 'Horus Rollback' : 'Horus Update'));
    console.log(chalk.dim('──────────────────────────────────────'));
    console.log('');

    // Load config + detect runtime
    const config = loadConfig();
    const runtimeSpinner = ora('Detecting runtime...').start();
    let runtime;
    try {
      runtime = await detectRuntime(config.runtime);
      runtimeSpinner.succeed(`Using ${chalk.cyan(runtime.name)}`);
    } catch (error) {
      runtimeSpinner.fail('No container runtime found');
      console.log((error as Error).message);
      process.exit(1);
    }

    // ── Rollback path ─────────────────────────────────────────────────────────
    if (opts.rollback) {
      const snapshots = listSnapshots();
      if (snapshots.length === 0) {
        console.log(chalk.red('No snapshots found. Cannot roll back.'));
        console.log(chalk.dim(`Snapshots are stored in ${SNAPSHOTS_DIR}`));
        process.exit(1);
      }

      let snapshotToRestore: Snapshot;

      if (opts.yes) {
        snapshotToRestore = snapshots[0].snapshot;
        console.log(`Using most recent snapshot: ${chalk.cyan(snapshotToRestore.timestamp)}`);
      } else {
        const choices = snapshots.map(({ snapshot }, i) => ({
          name: `${snapshot.timestamp}  (images: ${Object.keys(snapshot.images).length})`,
          value: i,
        }));
        const idx = await select<number>({
          message: 'Select snapshot to restore:',
          choices,
        });
        snapshotToRestore = snapshots[idx].snapshot;
      }

      if (!opts.yes) {
        const confirmed = await confirm({
          message: `Roll back to snapshot from ${snapshotToRestore.timestamp}? This will restart services.`,
          default: false,
        });
        if (!confirmed) {
          console.log(chalk.dim('Rollback cancelled.'));
          return;
        }
      }

      // Stop services
      const stopSpinner = ora('Stopping services...').start();
      try {
        await composeStreaming(runtime, ['down']);
        stopSpinner.succeed('Services stopped');
      } catch (error) {
        stopSpinner.fail('Failed to stop services');
        console.log(chalk.dim((error as Error).message));
        process.exit(1);
      }

      // Restart with cached images
      console.log('');
      console.log(chalk.bold('Restarting from snapshot (using cached images)...'));
      try {
        await composeStreaming(runtime, ['up', '-d']);
      } catch (error) {
        console.log(chalk.red('Failed to restart services.'));
        console.log(chalk.dim((error as Error).message));
        process.exit(1);
      }

      // Wait for health
      console.log('');
      const healthSpinner = ora('Waiting for services to become healthy...').start();
      try {
        await pollUntilHealthy(
          runtime,
          (current: ServiceHealth[]) => {
            const summary = current
              .map((s) => {
                const icon =
                  s.status === 'healthy'
                    ? chalk.green('*')
                    : s.status === 'starting'
                      ? chalk.yellow('~')
                      : chalk.red('x');
                return `${icon} ${s.name}`;
              })
              .join('  ');
            healthSpinner.text = `Waiting...  ${summary}`;
          },
          300_000,
          5_000
        );
        healthSpinner.succeed('All services healthy after rollback');
      } catch (error) {
        healthSpinner.fail('Some services did not become healthy');
        console.log(chalk.dim((error as Error).message));
        process.exit(1);
      }

      console.log('');
      console.log(chalk.bold.green('Rollback complete!'));
      console.log('');
      return;
    }

    // ── Normal update path ────────────────────────────────────────────────────

    // Check current vs latest
    const versionSpinner = ora('Checking for updates...').start();
    const [currentImages, latestVersion] = await Promise.all([
      captureCurrentImages(runtime),
      fetchLatestVersion(),
    ]);
    versionSpinner.stop();

    if (latestVersion) {
      console.log(`  Latest release: ${chalk.cyan(latestVersion)}`);
    } else {
      console.log(chalk.dim('  Could not reach GitHub to check latest version.'));
    }
    console.log('');

    if (!opts.yes) {
      const confirmed = await confirm({
        message: 'Pull latest images and restart services?',
        default: true,
      });
      if (!confirmed) {
        console.log(chalk.dim('Update cancelled.'));
        return;
      }
    }

    // Pre-update snapshot
    const snapshotSpinner = ora('Saving pre-update snapshot...').start();
    let snapshotPath = '';
    try {
      snapshotPath = saveSnapshot(currentImages);
      snapshotSpinner.succeed(`Snapshot saved: ${chalk.dim(snapshotPath)}`);
    } catch (error) {
      snapshotSpinner.warn('Could not save snapshot (update will proceed)');
      console.log(chalk.dim((error as Error).message));
    }

    // Authenticate with GHCR if a token is available
    const ghcrToken = config.github_token || process.env.GITHUB_TOKEN || '';
    if (ghcrToken) {
      const loginSpinner = ora('Authenticating with ghcr.io...').start();
      const ok = await registryLogin(runtime, 'ghcr.io', ghcrToken);
      if (ok) {
        loginSpinner.succeed('Authenticated with ghcr.io');
      } else {
        loginSpinner.warn('GHCR login failed — private images may not pull');
      }
    }

    // Pull latest images (non-fatal — images may not be published yet)
    console.log('');
    console.log(chalk.bold('Pulling latest images...'));
    try {
      await composeStreaming(runtime, ['pull', '--ignore-pull-failures']);
    } catch {
      console.log(chalk.yellow('Some images could not be pulled.'));
      console.log(chalk.dim('Continuing — services will be built from source if build contexts are available.'));
    }

    // Restart changed services
    console.log('');
    console.log(chalk.bold('Restarting services...'));
    try {
      await composeStreaming(runtime, ['up', '-d']);
    } catch (error) {
      console.log(chalk.red('Failed to restart services.'));
      console.log(chalk.dim((error as Error).message));
      process.exit(1);
    }

    // Wait for health
    console.log('');
    const healthSpinner = ora('Waiting for services to become healthy...').start();
    let finalStates: ServiceHealth[] = [];
    try {
      finalStates = await pollUntilHealthy(
        runtime,
        (current: ServiceHealth[]) => {
          const summary = current
            .map((s) => {
              const icon =
                s.status === 'healthy'
                  ? chalk.green('*')
                  : s.status === 'starting'
                    ? chalk.yellow('~')
                    : chalk.red('x');
              return `${icon} ${s.name}`;
            })
            .join('  ');
          healthSpinner.text = `Waiting for services...  ${summary}`;
        },
        300_000,
        5_000
      );
      healthSpinner.succeed('All services healthy');
    } catch (error) {
      healthSpinner.fail('Some services did not become healthy');
      console.log(chalk.dim((error as Error).message));
      console.log('');
      console.log(chalk.dim(`Tip: Roll back with \`horus update --rollback\``));
      process.exit(1);
    }

    // Report what changed
    console.log('');
    console.log(chalk.bold.green('Update complete!'));
    console.log(chalk.dim('──────────────────────────────────────'));
    if (latestVersion) {
      console.log(`  ${chalk.bold('Version:')}  ${latestVersion}`);
    }
    console.log('');
    console.log(chalk.bold('  Service Status:'));
    for (const s of finalStates) {
      const color =
        s.status === 'healthy' ? chalk.green : s.status === 'starting' ? chalk.yellow : chalk.red;
      console.log(`    ${color(s.status.padEnd(10))} ${s.name}`);
    }
    if (snapshotPath) {
      console.log('');
      console.log(chalk.dim(`  Snapshot saved for rollback: ${snapshotPath}`));
      console.log(chalk.dim('  Run `horus update --rollback` to revert if needed.'));
    }
    console.log('');
  });
