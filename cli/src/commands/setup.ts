import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import {
  loadConfig,
  saveConfig,
  writeEnvFile,
  configExists,
  defaultConfig,
  type Config,
} from '../lib/config.js';
import { detectRuntime, composeStreaming } from '../lib/runtime.js';
import { pollUntilHealthy, type ServiceHealth } from '../lib/health.js';
import { installComposeFile } from '../lib/compose.js';
import { DEFAULT_PORTS, DEFAULT_DATA_DIR } from '../lib/constants.js';

// ── Setup command ───────────────────────────────────────────────────────────

export const setupCommand = new Command('setup')
  .description('Interactive first-run setup for Horus')
  .option('-y, --yes', 'Non-interactive mode (use defaults + env vars)')
  .option('--api-key <key>', 'Anthropic API key')
  .option('--data-dir <path>', 'Data directory path')
  .option('--repos-path <path>', 'Host repos path for Forge scanning')
  .action(async (opts) => {
    console.log('');
    console.log(chalk.bold('Horus Setup'));
    console.log(chalk.dim('──────────────────────────────────────'));
    console.log('');

    // Step 1: Check if already configured
    if (configExists()) {
      if (opts.yes) {
        console.log(chalk.yellow('Existing configuration found. Overwriting in non-interactive mode.'));
      } else {
        const { proceed } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'proceed',
            message: 'Horus is already configured. Reconfigure?',
            default: false,
          },
        ]);
        if (!proceed) {
          console.log(chalk.dim('Setup cancelled.'));
          return;
        }
      }
    }

    // Step 2: Detect container runtime
    const runtimeSpinner = ora('Detecting container runtime...').start();
    let runtime;
    try {
      runtime = await detectRuntime();
      runtimeSpinner.succeed(`Detected ${chalk.cyan(runtime.name)}`);
    } catch (error) {
      runtimeSpinner.fail('No container runtime found');
      console.log('');
      console.log((error as Error).message);
      process.exit(1);
    }

    // Step 3: Gather configuration
    let config: Config;

    if (opts.yes) {
      // Non-interactive mode
      const apiKey = opts.apiKey || process.env.HORUS_API_KEY || '';
      if (!apiKey) {
        console.log(chalk.red('Error: API key is required.'));
        console.log(chalk.dim('Set HORUS_API_KEY env var or use --api-key flag.'));
        process.exit(1);
      }

      config = {
        ...defaultConfig(),
        api_key: apiKey,
        runtime: runtime.name,
        data_dir: opts.dataDir || DEFAULT_DATA_DIR,
        host_repos_path: opts.reposPath || '',
      };
    } else {
      // Interactive mode
      const answers = await inquirer.prompt([
        {
          type: 'password',
          name: 'api_key',
          message: 'Anthropic API key:',
          mask: '*',
          validate: (input: string) => {
            if (!input) return 'API key is required';
            if (!input.startsWith('sk-ant-')) return 'API key must start with "sk-ant-"';
            return true;
          },
        },
        {
          type: 'input',
          name: 'data_dir',
          message: 'Data directory:',
          default: DEFAULT_DATA_DIR,
        },
        {
          type: 'input',
          name: 'host_repos_path',
          message: 'Host repos path (for Forge repo scanning, leave empty to skip):',
          default: '',
        },
        {
          type: 'confirm',
          name: 'customize_ports',
          message: 'Customize port assignments?',
          default: false,
        },
      ]);

      let ports = { ...DEFAULT_PORTS };

      if (answers.customize_ports) {
        const portAnswers = await inquirer.prompt([
          {
            type: 'number',
            name: 'anvil',
            message: 'Anvil port:',
            default: DEFAULT_PORTS.anvil,
          },
          {
            type: 'number',
            name: 'vault_rest',
            message: 'Vault REST port:',
            default: DEFAULT_PORTS.vault_rest,
          },
          {
            type: 'number',
            name: 'vault_mcp',
            message: 'Vault MCP port:',
            default: DEFAULT_PORTS.vault_mcp,
          },
          {
            type: 'number',
            name: 'forge',
            message: 'Forge port:',
            default: DEFAULT_PORTS.forge,
          },
        ]);
        ports = portAnswers;
      }

      config = {
        ...defaultConfig(),
        api_key: answers.api_key,
        data_dir: answers.data_dir,
        host_repos_path: answers.host_repos_path,
        runtime: runtime.name,
        ports,
      };
    }

    // Step 4: Save config
    const configSpinner = ora('Saving configuration...').start();
    try {
      saveConfig(config);
      configSpinner.succeed('Configuration saved to ~/.horus/config.yaml');
    } catch (error) {
      configSpinner.fail('Failed to save configuration');
      console.error((error as Error).message);
      process.exit(1);
    }

    // Step 5: Generate .env
    const envSpinner = ora('Generating .env file...').start();
    try {
      writeEnvFile(config);
      envSpinner.succeed('Environment file written to ~/.horus/.env');
    } catch (error) {
      envSpinner.fail('Failed to generate .env');
      console.error((error as Error).message);
      process.exit(1);
    }

    // Step 6: Install compose file
    const composeSpinner = ora('Installing docker-compose.yml...').start();
    try {
      installComposeFile();
      composeSpinner.succeed('Compose file installed to ~/.horus/docker-compose.yml');
    } catch (error) {
      composeSpinner.fail('Failed to install compose file');
      console.error((error as Error).message);
      process.exit(1);
    }

    // Step 7: Pull images
    console.log('');
    console.log(chalk.bold('Pulling container images...'));
    try {
      await composeStreaming(runtime, ['pull']);
    } catch (error) {
      console.log(chalk.red('Failed to pull images.'));
      console.log(chalk.dim((error as Error).message));
      process.exit(1);
    }

    // Step 8: Start services
    console.log('');
    console.log(chalk.bold('Starting Horus services...'));
    try {
      await composeStreaming(runtime, ['up', '-d']);
    } catch (error) {
      console.log(chalk.red('Failed to start services.'));
      console.log(chalk.dim((error as Error).message));
      process.exit(1);
    }

    // Step 9: Poll health checks
    console.log('');
    const healthSpinner = ora('Waiting for services to become healthy...').start();

    let lastStates: ServiceHealth[] = [];
    try {
      const states = await pollUntilHealthy(
        runtime,
        (current) => {
          lastStates = current;
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
        600_000,
        5_000
      );
      healthSpinner.succeed('All services are healthy');
      lastStates = states;
    } catch (error) {
      healthSpinner.fail('Some services did not become healthy');
      console.log(chalk.dim((error as Error).message));
      console.log('');
      console.log(chalk.dim('Tip: Check logs with `docker compose logs` from ~/.horus/'));
      process.exit(1);
    }

    // Step 10: Print success summary
    console.log('');
    console.log(chalk.bold.green('Setup complete!'));
    console.log(chalk.dim('──────────────────────────────────────'));
    console.log('');
    console.log(`  ${chalk.bold('Runtime:')}    ${runtime.name}`);
    console.log(`  ${chalk.bold('Config:')}     ~/.horus/config.yaml`);
    console.log(`  ${chalk.bold('Data:')}       ${config.data_dir}`);
    console.log('');
    console.log(chalk.bold('  Service URLs:'));
    console.log(`    Anvil:      http://localhost:${config.ports.anvil}`);
    console.log(`    Vault REST: http://localhost:${config.ports.vault_rest}`);
    console.log(`    Vault MCP:  http://localhost:${config.ports.vault_mcp}`);
    console.log(`    Forge:      http://localhost:${config.ports.forge}`);
    console.log('');
  });
