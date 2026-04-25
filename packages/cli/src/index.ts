#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { setupCommand } from './commands/setup.js';
import { upCommand } from './commands/up.js';
import { downCommand } from './commands/down.js';
import { statusCommand } from './commands/status.js';
import { configCommand } from './commands/config.js';
import { connectCommand } from './commands/connect.js';
import { updateCommand } from './commands/update.js';
import { doctorCommand } from './commands/doctor.js';
import { backupCommand } from './commands/backup.js';
import { testEnvCommand } from './commands/test-env.js';
import { helpCommand } from './commands/help.js';
import { guideCommand } from './commands/guide.js';
import { repoCommand } from './commands/repo.js';
import { CLI_VERSION } from './lib/constants.js';

const program = new Command();

program
  .name('horus')
  .description('CLI for managing the Horus Docker Compose stack')
  .version(CLI_VERSION);

// Register commands
program.addCommand(setupCommand);
program.addCommand(upCommand);
program.addCommand(downCommand);
program.addCommand(statusCommand);
program.addCommand(configCommand);
program.addCommand(connectCommand);
program.addCommand(updateCommand);
program.addCommand(doctorCommand);
program.addCommand(backupCommand);
program.addCommand(testEnvCommand);
program.addCommand(helpCommand);
program.addCommand(guideCommand);
program.addCommand(repoCommand);

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
