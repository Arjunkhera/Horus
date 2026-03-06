import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import { mkdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { stringify as stringifyYaml } from 'yaml';
import { loadConfig } from '../lib/config.js';
import { detectRuntime, composeStreaming } from '../lib/runtime.js';
import { pollUntilHealthy, type ServiceHealth } from '../lib/health.js';
import { HORUS_DIR } from '../lib/constants.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const BACKUPS_DIR = join(HORUS_DIR, 'backups');

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureBackupsDir(): void {
  mkdirSync(BACKUPS_DIR, { recursive: true });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)}GB`;
}

// ── Create backup ─────────────────────────────────────────────────────────────

async function createBackup(yes: boolean): Promise<void> {
  console.log('');
  console.log(chalk.bold('Horus Backup'));
  console.log(chalk.dim('──────────────────────────────────────'));
  console.log('');

  const config = loadConfig();

  // Detect runtime
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

  if (!yes) {
    const confirmed = await confirm({
      message: 'This will briefly stop services to create a consistent backup. Continue?',
      default: true,
    });
    if (!confirmed) {
      console.log(chalk.dim('Backup cancelled.'));
      return;
    }
  }

  // Stop services gracefully (NOT down — preserves volumes)
  const stopSpinner = ora('Stopping services...').start();
  try {
    await composeStreaming(runtime, ['stop']);
    stopSpinner.succeed('Services stopped');
  } catch (error) {
    stopSpinner.fail('Failed to stop services');
    console.log(chalk.dim((error as Error).message));
    process.exit(1);
  }

  // Create backup
  ensureBackupsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tarFile = join(BACKUPS_DIR, `${timestamp}.tar.gz`);
  const metaFile = join(BACKUPS_DIR, `${timestamp}.meta.yaml`);

  const backupSpinner = ora('Creating backup archive...').start();
  try {
    // tar -czf <dest> -C ~/.horus data/
    // We archive the data/ subdirectory relative to HORUS_DIR
    execSync(`tar -czf "${tarFile}" -C "${HORUS_DIR}" data/`, {
      stdio: 'pipe',
    });
    backupSpinner.succeed(`Archive created: ${chalk.dim(tarFile)}`);
  } catch (error) {
    backupSpinner.fail('Failed to create backup archive');
    console.log(chalk.dim((error as Error).message));
    // Restart services before exiting
    await composeStreaming(runtime, ['start']).catch(() => {});
    process.exit(1);
  }

  // Write metadata
  let sizeBytes = 0;
  try {
    sizeBytes = statSync(tarFile).size;
  } catch {
    // ignore
  }

  const meta = {
    timestamp,
    data_dir: config.data_dir,
    version: config.version,
    size_bytes: sizeBytes,
  };
  writeFileSync(metaFile, stringifyYaml(meta, { lineWidth: 0 }), 'utf-8');

  // Restart services
  const startSpinner = ora('Restarting services...').start();
  try {
    await composeStreaming(runtime, ['start']);
    startSpinner.succeed('Services restarted');
  } catch (error) {
    startSpinner.fail('Failed to restart services');
    console.log(chalk.dim((error as Error).message));
    console.log(chalk.yellow('Run `horus up` to restart services manually.'));
  }

  // Report
  console.log('');
  console.log(chalk.bold.green('Backup complete!'));
  console.log(chalk.dim('──────────────────────────────────────'));
  console.log(`  ${chalk.bold('File:')}  ${tarFile}`);
  console.log(`  ${chalk.bold('Size:')}  ${formatBytes(sizeBytes)}`);
  console.log('');
  console.log(chalk.dim('  Restore with: horus backup restore <file>'));
  console.log('');
}

// ── Restore backup ────────────────────────────────────────────────────────────

async function restoreBackup(file: string, yes: boolean): Promise<void> {
  console.log('');
  console.log(chalk.bold('Horus Restore'));
  console.log(chalk.dim('──────────────────────────────────────'));
  console.log('');

  if (!existsSync(file)) {
    console.log(chalk.red(`Backup file not found: ${file}`));
    process.exit(1);
  }

  const config = loadConfig();

  // Detect runtime
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

  if (!yes) {
    console.log(chalk.yellow(`  Warning: This will overwrite current data in ${config.data_dir}`));
    console.log('');
    const confirmed = await confirm({
      message: `Restore from ${basename(file)}? Current data will be overwritten.`,
      default: false,
    });
    if (!confirmed) {
      console.log(chalk.dim('Restore cancelled.'));
      return;
    }
  }

  // Stop services
  const stopSpinner = ora('Stopping services...').start();
  try {
    await composeStreaming(runtime, ['stop']);
    stopSpinner.succeed('Services stopped');
  } catch (error) {
    stopSpinner.fail('Failed to stop services');
    console.log(chalk.dim((error as Error).message));
    process.exit(1);
  }

  // Extract archive
  const extractSpinner = ora('Extracting backup...').start();
  try {
    execSync(`tar -xzf "${file}" -C "${HORUS_DIR}/"`, { stdio: 'pipe' });
    extractSpinner.succeed('Backup extracted');
  } catch (error) {
    extractSpinner.fail('Failed to extract backup');
    console.log(chalk.dim((error as Error).message));
    // Try to restart services anyway
    await composeStreaming(runtime, ['start']).catch(() => {});
    process.exit(1);
  }

  // Start services
  console.log('');
  console.log(chalk.bold('Starting services...'));
  try {
    await composeStreaming(runtime, ['start']);
  } catch (error) {
    console.log(chalk.red('Failed to start services.'));
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
        healthSpinner.text = `Waiting for services...  ${summary}`;
      },
      300_000,
      5_000
    );
    healthSpinner.succeed('All services healthy');
  } catch (error) {
    healthSpinner.fail('Some services did not become healthy');
    console.log(chalk.dim((error as Error).message));
    process.exit(1);
  }

  console.log('');
  console.log(chalk.bold.green('Restore complete!'));
  console.log('');
}

// ── Backup command ────────────────────────────────────────────────────────────

export const backupCommand = new Command('backup')
  .description('Backup or restore Horus data')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(async (opts) => {
    await createBackup(opts.yes as boolean);
  });

// Subcommand: horus backup restore <file>
backupCommand
  .command('restore <file>')
  .description('Restore Horus data from a backup file')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(async (file: string, opts) => {
    await restoreBackup(file, opts.yes as boolean);
  });
