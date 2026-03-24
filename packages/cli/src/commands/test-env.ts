import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadConfig } from '../lib/config.js';
import { detectRuntime } from '../lib/runtime.js';
import {
  loadTestEnvConfig,
  findFreeSlot,
  calcPorts,
  getSlotDataPath,
  createSlotDirs,
  removeSlotDirs,
  writeLock,
  removeLock,
  readLock,
  composeUp,
  composeDown,
  waitForShadowStackHealthy,
  getAllSlotStatuses,
  seedFromFixtures,
  seedFromLive,
  projectName,
  preSeedNotesDir,
} from '../lib/test-env.js';

// ── horus test-env ───────────────────────────────────────────────────────────

export const testEnvCommand = new Command('test-env')
  .description('Manage isolated shadow stacks for integration testing');

// ── acquire ──────────────────────────────────────────────────────────────────

testEnvCommand
  .command('acquire')
  .description('Start a shadow stack on alternate ports with isolated data')
  .option('--timeout <seconds>', 'Max wait for health checks (default: 120)', '120')
  .action(async (opts) => {
    const config = loadConfig();
    const dataDir = config.data_dir;
    const testCfg = loadTestEnvConfig(dataDir);

    const spinner = ora('Detecting runtime...').start();
    let runtime;
    try {
      runtime = await detectRuntime(config.runtime);
      spinner.succeed(`Using ${chalk.cyan(runtime.name)}`);
    } catch (error) {
      spinner.fail('No container runtime found');
      console.error((error as Error).message);
      process.exit(1);
    }

    // Find a free slot (auto-expires stale locks)
    const slot = findFreeSlot(dataDir, testCfg);
    if (slot === null) {
      console.error(chalk.red(
        `All ${testCfg.max_slots} slot(s) are in use. ` +
        `Run ${chalk.bold('horus test-env status')} to see active slots, ` +
        `or ${chalk.bold('horus test-env release')} to free one.`
      ));
      process.exit(1);
    }

    const ports = calcPorts(slot, testCfg.base_port);
    const slotDataPath = getSlotDataPath(dataDir, slot);
    const project = projectName(slot);

    // Create isolated data directories
    const dirSpinner = ora(`Creating slot-${slot} data directories...`).start();
    createSlotDirs(slotDataPath);
    dirSpinner.succeed(`Data directory: ${chalk.dim(slotDataPath)}`);

    // Pre-seed notes dir so Anvil finds a valid git repo instead of HTTPS-cloning
    const seedSpinner = ora('Pre-seeding notes directory...').start();
    try {
      await preSeedNotesDir(dataDir, slotDataPath);
      seedSpinner.succeed('Notes directory ready');
    } catch (error) {
      seedSpinner.fail(`Notes pre-seed failed: ${(error as Error).message}`);
      removeLock(dataDir, slot);
      removeSlotDirs(slotDataPath);
      process.exit(1);
    }

    // Write lock file before starting compose (so other agents see it occupied)
    writeLock(dataDir, {
      slot,
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      ports,
      dataPath: slotDataPath,
    });

    // Start shadow stack
    const upSpinner = ora(`Starting shadow stack (project ${chalk.cyan(project)})...`).start();
    try {
      await composeUp(runtime, project, ports, slotDataPath);
      upSpinner.succeed(`Shadow stack started`);
    } catch (error) {
      upSpinner.fail('Failed to start shadow stack');
      removeLock(dataDir, slot);
      removeSlotDirs(slotDataPath);
      console.error((error as Error).message);
      process.exit(1);
    }

    // Wait for health
    const healthSpinner = ora('Waiting for services to be healthy...').start();
    const timeoutMs = parseInt(opts.timeout, 10) * 1000;
    try {
      await waitForShadowStackHealthy(runtime, project, timeoutMs, 3_000, (statuses) => {
        const parts = Object.entries(statuses)
          .map(([svc, s]) => `${svc}:${s === 'healthy' ? chalk.green(s) : chalk.yellow(s)}`)
          .join('  ');
        healthSpinner.text = `Waiting for services... ${parts}`;
      });
      healthSpinner.succeed('All services healthy');
    } catch (error) {
      healthSpinner.fail('Health check failed');
      await composeDown(runtime, project, ports, slotDataPath);
      removeLock(dataDir, slot);
      removeSlotDirs(slotDataPath);
      console.error((error as Error).message);
      process.exit(1);
    }

    // Output connection info
    console.log('');
    console.log(chalk.bold.green(`✓ Slot ${slot} acquired`));
    console.log('');
    console.log(chalk.bold('Connection info:'));
    console.log(`  Slot:       ${chalk.cyan(slot)}`);
    console.log(`  Project:    ${chalk.cyan(project)}`);
    console.log(`  Data:       ${chalk.dim(slotDataPath)}`);
    console.log('');
    console.log(chalk.bold('Ports:'));
    console.log(`  Anvil:        http://localhost:${chalk.cyan(ports.anvil)}`);
    console.log(`  Forge:        http://localhost:${chalk.cyan(ports.forge)}`);
    console.log(`  Vault MCP:    http://localhost:${chalk.cyan(ports.vault_mcp)}`);
    console.log(`  Vault Router: http://localhost:${chalk.cyan(ports.vault_router)}`);
    console.log(`  Typesense:    http://localhost:${chalk.cyan(ports.typesense)}`);
    console.log(`  UI:           http://localhost:${chalk.cyan(ports.ui)}`);
    console.log('');
    console.log(chalk.bold('Environment:'));
    console.log(`  export TEST_SLOT=${slot}`);
    console.log(`  export TEST_ANVIL_URL=http://localhost:${ports.anvil}`);
    console.log(`  export TEST_FORGE_URL=http://localhost:${ports.forge}`);
    console.log(`  export TEST_VAULT_MCP_URL=http://localhost:${ports.vault_mcp}`);
    console.log(`  export TEST_DATA_PATH=${slotDataPath}`);
    console.log('');
    console.log(chalk.dim(`Run ${chalk.bold(`horus test-env seed --slot ${slot}`)} to populate with fixtures.`));
    console.log(chalk.dim(`Run ${chalk.bold(`horus test-env release --slot ${slot}`)} when done.`));
  });

// ── release ──────────────────────────────────────────────────────────────────

testEnvCommand
  .command('release')
  .description('Tear down a shadow stack and remove its data')
  .option('--slot <n>', 'Slot number to release (default: auto-detect acquired slot)')
  .action(async (opts) => {
    const config = loadConfig();
    const dataDir = config.data_dir;
    const testCfg = loadTestEnvConfig(dataDir);

    // Resolve slot
    let slot: number;
    if (opts.slot !== undefined) {
      slot = parseInt(opts.slot, 10);
    } else {
      // Auto-detect: find the first acquired slot
      const statuses = getAllSlotStatuses(dataDir, testCfg);
      const acquired = statuses.find((s) => s.state === 'acquired' || s.state === 'expired');
      if (!acquired) {
        console.log(chalk.yellow('No active slots found.'));
        return;
      }
      slot = acquired.slot;
    }

    const lock = readLock(dataDir, slot);
    const slotDataPath = getSlotDataPath(dataDir, slot);
    const project = projectName(slot);
    const ports = lock?.ports ?? calcPorts(slot, testCfg.base_port);

    const spinner = ora('Detecting runtime...').start();
    let runtime;
    try {
      runtime = await detectRuntime(config.runtime);
      spinner.succeed(`Using ${chalk.cyan(runtime.name)}`);
    } catch (error) {
      spinner.fail('No container runtime found');
      console.error((error as Error).message);
      process.exit(1);
    }

    // Stop compose
    const downSpinner = ora(`Stopping ${chalk.cyan(project)}...`).start();
    try {
      await composeDown(runtime, project, ports, slotDataPath);
      downSpinner.succeed('Shadow stack stopped');
    } catch {
      downSpinner.warn('Failed to stop cleanly (continuing cleanup)');
    }

    // Remove data and lock
    const cleanSpinner = ora('Removing test data...').start();
    removeSlotDirs(slotDataPath);
    removeLock(dataDir, slot);
    cleanSpinner.succeed('Test data removed');

    console.log('');
    console.log(chalk.bold.green(`✓ Slot ${slot} released`));
  });

// ── status ───────────────────────────────────────────────────────────────────

testEnvCommand
  .command('status')
  .description('Show active shadow stack slots')
  .action(() => {
    const config = loadConfig();
    const dataDir = config.data_dir;
    const testCfg = loadTestEnvConfig(dataDir);
    const statuses = getAllSlotStatuses(dataDir, testCfg);

    const acquiredCount = statuses.filter((s) => s.state === 'acquired').length;
    console.log('');
    console.log(chalk.bold('Test Environment Status'));
    console.log(`  Max slots:  ${testCfg.max_slots}`);
    console.log(`  In use:     ${acquiredCount} / ${testCfg.max_slots}`);
    console.log(`  Base port:  ${testCfg.base_port}`);
    console.log('');

    if (statuses.every((s) => s.state === 'free')) {
      console.log(chalk.dim('  No active slots.'));
      console.log('');
      return;
    }

    for (const s of statuses) {
      if (s.state === 'free') continue;

      const stateLabel =
        s.state === 'expired'
          ? chalk.yellow('EXPIRED')
          : chalk.green('ACTIVE');

      console.log(`  ${chalk.bold(`Slot ${s.slot}`)}  ${stateLabel}`);
      if (s.acquiredAt) {
        console.log(`    Acquired: ${s.acquiredAt} (${s.elapsedMinutes}m ago)`);
      }
      if (s.ports) {
        console.log(`    Ports:    anvil=${s.ports.anvil}  forge=${s.ports.forge}  vault-mcp=${s.ports.vault_mcp}  typesense=${s.ports.typesense}`);
      }
      if (s.dataPath) {
        console.log(`    Data:     ${chalk.dim(s.dataPath)}`);
      }
      console.log('');
    }
  });

// ── seed ─────────────────────────────────────────────────────────────────────

testEnvCommand
  .command('seed')
  .description('Populate a slot with test fixtures (or a snapshot of live data)')
  .option('--slot <n>', 'Slot to seed (default: auto-detect)')
  .option('--from-live', 'Snapshot live data instead of using fixtures')
  .action(async (opts) => {
    const config = loadConfig();
    const dataDir = config.data_dir;
    const testCfg = loadTestEnvConfig(dataDir);

    // Resolve slot
    let slot: number;
    if (opts.slot !== undefined) {
      slot = parseInt(opts.slot, 10);
    } else {
      const statuses = getAllSlotStatuses(dataDir, testCfg);
      const acquired = statuses.find((s) => s.state === 'acquired');
      if (!acquired) {
        console.error(chalk.red('No active slot found. Run `horus test-env acquire` first.'));
        process.exit(1);
      }
      slot = acquired.slot;
    }

    const slotDataPath = getSlotDataPath(dataDir, slot);

    if (opts.fromLive) {
      const spinner = ora('Snapshotting live data into slot...').start();
      try {
        seedFromLive(dataDir, slotDataPath);
        spinner.succeed('Live data snapshotted');
      } catch (error) {
        spinner.fail('Failed to snapshot live data');
        console.error((error as Error).message);
        process.exit(1);
      }
    } else {
      // Locate fixtures relative to CLI package (repo root is 3 dirs up from src/commands/)
      const here = dirname(fileURLToPath(import.meta.url));
      const repoRoot = join(here, '..', '..', '..', '..', '..');
      const fixturesPath = join(repoRoot, 'test', 'fixtures');

      const spinner = ora(`Seeding slot-${slot} from fixtures...`).start();
      try {
        seedFromFixtures(fixturesPath, slotDataPath);
        spinner.succeed(`Slot ${slot} seeded from fixtures`);
      } catch (error) {
        spinner.fail('Failed to seed fixtures');
        console.error((error as Error).message);
        process.exit(1);
      }
    }

    console.log('');
    console.log(chalk.dim('Services will re-index automatically. Allow ~10s before running tests.'));
  });
