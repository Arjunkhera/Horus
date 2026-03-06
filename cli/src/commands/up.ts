import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { configExists, loadConfig } from '../lib/config.js';
import { detectRuntime, composeStreaming } from '../lib/runtime.js';
import { checkAllHealth } from '../lib/health.js';
import { composeFileExists } from '../lib/compose.js';

// ── Up command ──────────────────────────────────────────────────────────────

export const upCommand = new Command('up')
  .description('Start the Horus stack')
  .action(async () => {
    // Check that setup has been run
    if (!configExists() || !composeFileExists()) {
      console.log(chalk.red('Horus is not set up yet.'));
      console.log(chalk.dim('Run `horus setup` first.'));
      process.exit(1);
    }

    const config = loadConfig();

    // Detect runtime
    const spinner = ora('Detecting runtime...').start();
    let runtime;
    try {
      runtime = await detectRuntime(config.runtime);
      spinner.succeed(`Using ${chalk.cyan(runtime.name)}`);
    } catch (error) {
      spinner.fail('No container runtime found');
      console.log((error as Error).message);
      process.exit(1);
    }

    // Start services
    console.log('');
    console.log(chalk.bold('Starting Horus services...'));
    try {
      await composeStreaming(runtime, ['up', '-d']);
    } catch (error) {
      console.log(chalk.red('Failed to start services.'));
      console.log(chalk.dim((error as Error).message));
      process.exit(1);
    }

    // Show status
    console.log('');
    const statusSpinner = ora('Checking service status...').start();
    try {
      const states = await checkAllHealth(runtime);
      statusSpinner.stop();

      console.log(chalk.bold('Service Status:'));
      for (const s of states) {
        const color =
          s.status === 'healthy'
            ? chalk.green
            : s.status === 'starting'
              ? chalk.yellow
              : chalk.red;
        console.log(`  ${color(s.status.padEnd(10))} ${s.name}`);
      }

      const allHealthy = states.every((s) => s.status === 'healthy');
      if (!allHealthy) {
        console.log('');
        console.log(
          chalk.yellow('Some services are still starting. Run `horus status` to check progress.')
        );
      }
    } catch {
      statusSpinner.warn('Could not check service status');
    }

    console.log('');
  });
