import { Command } from 'commander';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import {
  loadConfig,
  saveConfig,
  writeEnvFile,
  configExists,
  maskApiKey,
  getConfigValue,
  setConfigValue,
  CONFIG_KEYS,
  type ConfigKey,
} from '../lib/config.js';

// ── Config command ──────────────────────────────────────────────────────────

export const configCommand = new Command('config')
  .description('View or modify Horus configuration')
  .action(async () => {
    // Default action: print current config
    if (!configExists()) {
      console.log(chalk.red('Horus is not configured yet.'));
      console.log(chalk.dim('Run `horus setup` first.'));
      process.exit(1);
    }

    const config = loadConfig();

    console.log('');
    console.log(chalk.bold('Horus Configuration'));
    console.log(chalk.dim('──────────────────────────────────────'));
    console.log(`  ${chalk.bold('version:')}          ${config.version}`);
    console.log(`  ${chalk.bold('data-dir:')}         ${config.data_dir}`);
    console.log(`  ${chalk.bold('runtime:')}          ${config.runtime}`);
    console.log(`  ${chalk.bold('host-repos-path:')}             ${config.host_repos_path || chalk.dim('(not set)')}`);
    const extraDirs = (config.host_repos_extra_scan_dirs ?? []).join(', ');
    console.log(`  ${chalk.bold('host-repos-extra-scan-dirs:')}  ${extraDirs || chalk.dim('(not set)')}`);
    console.log(`  ${chalk.bold('git-host:')}                    ${config.git_host || chalk.dim('(not set)')}`);
    console.log(`  ${chalk.bold('github-token:')}     ${config.github_token ? maskApiKey(config.github_token) : chalk.dim('(not set)')}`);
    console.log('');
    console.log(chalk.bold('  Ports:'));
    console.log(`    ${chalk.bold('anvil:')}       ${config.ports.anvil}`);
    console.log(`    ${chalk.bold('vault-rest:')}  ${config.ports.vault_rest}`);
    console.log(`    ${chalk.bold('vault-mcp:')}   ${config.ports.vault_mcp}`);
    console.log(`    ${chalk.bold('forge:')}       ${config.ports.forge}`);
    console.log('');
    console.log(chalk.bold('  Repos:'));
    console.log(`    ${chalk.bold('anvil-notes:')}      ${config.repos.anvil_notes || chalk.dim('(not set)')}`);
    console.log(`    ${chalk.bold('vault-knowledge:')}  ${config.repos.vault_knowledge || chalk.dim('(not set)')}`);
    console.log(`    ${chalk.bold('forge-registry:')}   ${config.repos.forge_registry || chalk.dim('(not set)')}`);
    console.log('');
    console.log(chalk.dim(`  Config file: ~/Horus/config.yaml`));
    console.log(chalk.dim(`  Use 'horus config get <key>' or 'horus config set <key> <value>'`));
    console.log('');
  });

// ── Config get subcommand ───────────────────────────────────────────────────

configCommand
  .command('get <key>')
  .description('Get a configuration value')
  .action(async (key: string) => {
    if (!configExists()) {
      console.log(chalk.red('Horus is not configured yet.'));
      console.log(chalk.dim('Run `horus setup` first.'));
      process.exit(1);
    }

    if (!isValidKey(key)) {
      console.log(chalk.red(`Unknown config key: ${key}`));
      console.log(chalk.dim(`Valid keys: ${CONFIG_KEYS.join(', ')}`));
      process.exit(1);
    }

    const config = loadConfig();
    const value = getConfigValue(config, key as ConfigKey);

    // Mask sensitive values
    if (key === 'github-token') {
      console.log(maskApiKey(value));
    } else {
      console.log(value || '');
    }
  });

// ── Config set subcommand ───────────────────────────────────────────────────

configCommand
  .command('set <key> <value>')
  .description('Set a configuration value')
  .action(async (key: string, value: string) => {
    if (!configExists()) {
      console.log(chalk.red('Horus is not configured yet.'));
      console.log(chalk.dim('Run `horus setup` first.'));
      process.exit(1);
    }

    if (!isValidKey(key)) {
      console.log(chalk.red(`Unknown config key: ${key}`));
      console.log(chalk.dim(`Valid keys: ${CONFIG_KEYS.join(', ')}`));
      process.exit(1);
    }

    let config = loadConfig();

    try {
      config = setConfigValue(config, key as ConfigKey, value);
    } catch (error) {
      console.log(chalk.red((error as Error).message));
      process.exit(1);
    }

    // Save config and regenerate .env
    saveConfig(config);
    writeEnvFile(config);

    console.log(chalk.green(`Set ${key} and regenerated .env file.`));

    // Prompt to restart if services might be affected
    const needsRestart = [
      'data-dir',
      'host-repos-path',
      'host-repos-extra-scan-dirs',
      'runtime',
      'port.anvil',
      'port.vault-rest',
      'port.vault-mcp',
      'port.forge',
    ];

    if (needsRestart.includes(key)) {
      console.log(chalk.yellow('Restart required for changes to take effect.'));

      // Only prompt interactively if we have a TTY
      if (process.stdin.isTTY) {
        const restart = await confirm({
          message: 'Restart Horus now?',
          default: false,
        });

        if (restart) {
          console.log(chalk.dim('Run `horus down && horus up` to restart.'));
        }
      } else {
        console.log(chalk.dim('Run `horus down && horus up` to restart.'));
      }
    }
  });

// ── Helpers ─────────────────────────────────────────────────────────────────

function isValidKey(key: string): key is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(key);
}
