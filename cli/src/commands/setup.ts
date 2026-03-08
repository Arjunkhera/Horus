import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
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
  .option('--git-host <host>', 'Git server hostname (e.g., github.com, gitlab.corp.com)')
  .option('--anvil-repo <url>', 'Anvil notes repository URL')
  .option('--vault-repo <url>', 'Vault knowledge-base repository URL')
  .option('--forge-repo <url>', 'Forge registry repository URL')
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
      // Non-interactive mode — use flags, env vars, then defaults
      const defaults = defaultConfig();
      config = {
        ...defaults,
        runtime: runtime.name,
        data_dir: opts.dataDir || DEFAULT_DATA_DIR,
        host_repos_path: opts.reposPath || '',
        git_host: opts.gitHost || defaults.git_host,
        repos: {
          anvil_notes: opts.anvilRepo || process.env.ANVIL_REPO_URL || defaults.repos.anvil_notes,
          vault_knowledge: opts.vaultRepo || process.env.VAULT_KNOWLEDGE_REPO_URL || defaults.repos.vault_knowledge,
          forge_registry: opts.forgeRepo || process.env.FORGE_REGISTRY_REPO_URL || defaults.repos.forge_registry,
        },
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

      // Git host + Repository URLs
      console.log('');
      console.log(chalk.bold('Repository Configuration'));
      console.log(chalk.dim('Horus stores notes and knowledge in Git repos you own.'));
      console.log(chalk.dim('Create empty repos on your Git server, then paste the URLs below.'));
      console.log('');

      const git_host = await input({
        message: 'Git server hostname:',
        default: 'github.com',
      });

      const host = git_host.trim();
      const example = (repo: string) => chalk.dim(`  e.g., git@${host}:<owner>/${repo}.git`);

      console.log('');

      const anvil_notes = await input({
        message: `Anvil notes repo URL:\n${example('horus-notes')}\n`,
        validate: (v) => v.trim().length > 0 || 'Anvil needs a notes repo to store your data.',
      });

      const vault_knowledge = await input({
        message: `Vault knowledge-base repo URL:\n${example('knowledge-base')}\n`,
        validate: (v) => v.trim().length > 0 || 'Vault needs a knowledge-base repo.',
      });

      const forge_registry = await input({
        message: `Forge registry repo URL:\n${example('forge-registry')}\n`,
        validate: (v) => v.trim().length > 0 || 'Forge needs a registry repo.',
      });

      config = {
        ...defaultConfig(),
        data_dir,
        host_repos_path,
        runtime: runtime.name,
        ports,
        git_host: git_host.trim(),
        repos: {
          anvil_notes: anvil_notes.trim(),
          vault_knowledge: vault_knowledge.trim(),
          forge_registry: forge_registry.trim(),
        },
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

    // Step 7: Clone repos to data directory using host git credentials
    const dataDir = config.data_dir.startsWith('~')
      ? join(process.env.HOME || '', config.data_dir.slice(1))
      : config.data_dir;

    const reposToClone: Array<{ url: string; dest: string; label: string }> = [
      { url: config.repos.anvil_notes, dest: join(dataDir, 'notes'), label: 'Anvil notes' },
      { url: config.repos.vault_knowledge, dest: join(dataDir, 'knowledge-base'), label: 'Vault knowledge-base' },
      { url: config.repos.forge_registry, dest: join(dataDir, 'registry'), label: 'Forge registry' },
    ].filter((r) => r.url);

    if (reposToClone.length > 0) {
      console.log('');
      console.log(chalk.bold('Cloning repositories...'));
      mkdirSync(dataDir, { recursive: true });

      for (const repo of reposToClone) {
        const spinner = ora(`Cloning ${repo.label}...`).start();

        if (existsSync(join(repo.dest, '.git'))) {
          spinner.succeed(`${repo.label} already cloned`);
          continue;
        }

        try {
          mkdirSync(repo.dest, { recursive: true });
          execSync(`git clone "${repo.url}" "${repo.dest}"`, {
            stdio: 'pipe',
            timeout: 60_000,
          });
          spinner.succeed(`${repo.label} cloned`);
        } catch (error) {
          spinner.fail(`Failed to clone ${repo.label}`);
          const msg = (error as Error).message || '';
          if (msg.includes('already exists and is not an empty directory')) {
            console.log(chalk.dim('  Directory exists but has no .git — check the path.'));
          } else {
            console.log(chalk.dim(`  ${msg.split('\n')[0]}`));
          }
          console.log(chalk.dim(`  URL: ${repo.url}`));
          console.log(chalk.dim('  Ensure you have git access (SSH key or credential helper).'));
          process.exit(1);
        }
      }
    }

    // Step 8: Pull images (non-fatal — images may not be published yet)
    console.log('');
    console.log(chalk.bold('Pulling container images...'));
    try {
      await composeStreaming(runtime, ['pull', '--ignore-pull-failures']);
    } catch {
      console.log(chalk.yellow('Some images could not be pulled.'));
      console.log(chalk.dim('Continuing — services will be built from source if build contexts are available.'));
    }

    // Step 9: Start services
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
