import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { configExists, loadConfig } from '../lib/config.js';
import { detectRuntime, composeStreaming } from '../lib/runtime.js';
import { composeFileExists } from '../lib/compose.js';

// ── Down command ────────────────────────────────────────────────────────────

export const downCommand = new Command('down')
  .description('Stop the Horus stack')
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

    // Stop services (NEVER with -v to preserve data volumes)
    console.log('');
    console.log(chalk.bold('Stopping Horus services...'));
    try {
      await composeStreaming(runtime, ['down']);
    } catch (error) {
      console.log(chalk.red('Failed to stop services.'));
      console.log(chalk.dim((error as Error).message));
      process.exit(1);
    }

    console.log('');
    console.log(chalk.green('All services stopped.'));
    console.log(chalk.dim('Data volumes have been preserved. Run `horus up` to restart.'));
    console.log('');
  });
