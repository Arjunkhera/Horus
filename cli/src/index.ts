#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { setupCommand } from './commands/setup.js';
import { upCommand } from './commands/up.js';
import { downCommand } from './commands/down.js';
import { statusCommand } from './commands/status.js';
import { configCommand } from './commands/config.js';

const program = new Command();

program
  .name('horus')
  .description('CLI for managing the Horus Docker Compose stack')
  .version('0.1.0');

// Register commands
program.addCommand(setupCommand);
program.addCommand(upCommand);
program.addCommand(downCommand);
program.addCommand(statusCommand);
program.addCommand(configCommand);

// Global error handling
program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  // Commander throws for --help and --version, which is expected
  if ((error as any).code === 'commander.helpDisplayed' || (error as any).code === 'commander.version') {
    process.exit(0);
  }

  // For other errors, print a user-friendly message
  if (error instanceof Error) {
    console.error(chalk.red(`Error: ${error.message}`));
  } else {
    console.error(chalk.red('An unexpected error occurred.'));
  }
  process.exit(1);
}
