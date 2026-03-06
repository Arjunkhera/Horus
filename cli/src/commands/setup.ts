import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { input, confirm, number, select } from '@inquirer/prompts';
import {
  loadConfig,
  saveConfig,
  writeEnvFile,
  configExists,
  defaultConfig,
  type Config,
} from '../lib/config.js';
import { checkRuntime, detectRuntime, composeStreaming } from '../lib/runtime.js';
import { pollUntilHealthy, type ServiceHealth } from '../lib/health.js';
import { installComposeFile } from '../lib/compose.js';
import { DEFAULT_PORTS, DEFAULT_DATA_DIR } from '../lib/constants.js';

// ── Setup command ───────────────────────────────────────────────────────────

export const setupCommand = new Command('setup')
  .description('Interactive first-run setup for Horus')
  .option('-y, --yes', 'Non-interactive mode (use defaults + env vars)')
  .option('--runtime <runtime>', 'Container runtime to use: docker or podman (non-interactive only)')
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
        const proceed = await confirm({
          message: 'Horus is already configured. Reconfigure?',
          default: false,
        });
        if (!proceed) {
          console.log(chalk.dim('Setup cancelled.'));
          return;
        }
      }
    }

    // Step 2: Choose container runtime
    const checkSpinner = ora('Checking for container runtimes...').start();
    const [hasDocker, hasPodman] = await Promise.all([
      checkRuntime('docker'),
      checkRuntime('podman'),
    ]);
    checkSpinner.stop();

    const available = [
      ...(hasDocker ? ['docker' as const] : []),
      ...(hasPodman ? ['podman' as const] : []),
    ];

    if (available.length === 0) {
      console.log(chalk.red('No container runtime found.'));
      console.log('');
      console.log('Horus requires Docker or Podman with the Compose plugin.');
      console.log('');
      console.log('Install one of:');
      console.log('  Docker Desktop: https://www.docker.com/products/docker-desktop/');
      console.log('  Podman Desktop: https://podman-desktop.io/');
      process.exit(1);
    }

    let selectedRuntime: 'docker' | 'podman';

    if (opts.yes) {
      // Non-interactive: use --runtime flag or first available
      const requested = opts.runtime as 'docker' | 'podman' | undefined;
      if (requested && !available.includes(requested)) {
        console.log(chalk.red(`Requested runtime "${requested}" is not installed.`));
        console.log(chalk.dim(`Available: ${available.join(', ')}`));
        process.exit(1);
      }
      selectedRuntime = requested ?? available[0];
      console.log(`Using ${chalk.cyan(selectedRuntime)}`);
    } else {
      selectedRuntime = await select({
        message: 'Which container runtime would you like to use?',
        choices: available.map((r) => ({
          value: r,
          name: r === 'docker' ? 'Docker' : 'Podman',
        })),
      });
    }

    const runtime = await detectRuntime(selectedRuntime);

    // Step 3: Gather configuration
    let config: Config;

    if (opts.yes) {
      // Non-interactive mode
      config = {
        ...defaultConfig(),
        runtime: runtime.name,
        data_dir: opts.dataDir || DEFAULT_DATA_DIR,
        host_repos_path: opts.reposPath || '',
      };
    } else {
      // Interactive mode
      const data_dir = await input({
        message: 'Data directory:',
        default: DEFAULT_DATA_DIR,
      });

      const host_repos_path = await input({
        message: 'Host repos path (for Forge repo scanning, leave empty to skip):',
        default: '',
      });

      const customize_ports = await confirm({
        message: 'Customize port assignments?',
        default: false,
      });

      let ports: { anvil: number; vault_rest: number; vault_mcp: number; forge: number } = { ...DEFAULT_PORTS };

      if (customize_ports) {
        const anvil = await number({
          message: 'Anvil port:',
          default: DEFAULT_PORTS.anvil,
        });
        const vault_rest = await number({
          message: 'Vault REST port:',
          default: DEFAULT_PORTS.vault_rest,
        });
        const vault_mcp = await number({
          message: 'Vault MCP port:',
          default: DEFAULT_PORTS.vault_mcp,
        });
        const forge = await number({
          message: 'Forge port:',
          default: DEFAULT_PORTS.forge,
        });
        ports = {
          anvil: anvil ?? DEFAULT_PORTS.anvil,
          vault_rest: vault_rest ?? DEFAULT_PORTS.vault_rest,
          vault_mcp: vault_mcp ?? DEFAULT_PORTS.vault_mcp,
          forge: forge ?? DEFAULT_PORTS.forge,
        };
      }

      config = {
        ...defaultConfig(),
        data_dir,
        host_repos_path,
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
