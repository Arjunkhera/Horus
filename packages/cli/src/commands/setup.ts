import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { input, confirm, number, select, password } from '@inquirer/prompts';
import {
  loadConfig,
  saveConfig,
  writeEnvFile,
  configExists,
  defaultConfig,
  resolveConfigPath,
  resolveGitHubHost,
  type Config,
  type VaultConfig,
  type GitHubHost,
} from '../lib/config.js';
import { checkRuntime, detectRuntime, composeStreaming } from '../lib/runtime.js';
import { pollUntilHealthy, type ServiceHealth } from '../lib/health.js';
import { installComposeFile } from '../lib/compose.js';
import { DEFAULT_PORTS, DEFAULT_DATA_DIR } from '../lib/constants.js';
import { runConnect, detectInstalledClients } from './connect.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Embed a token into an HTTPS clone URL so git can authenticate without a
 * credential helper. Returns the URL unchanged if no token is provided.
 * git masks passwords in error output, so the token won't appear in logs.
 */
function injectToken(url: string, token: string): string {
  if (!token) return url;
  try {
    const parsed = new URL(url);
    parsed.username = 'oauth2';
    parsed.password = token;
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Extract the hostname from a URL, falling back to 'github.com' on parse error.
 */
function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'github.com';
  }
}

// ── Setup command ───────────────────────────────────────────────────────────

export const setupCommand = new Command('setup')
  .description('Interactive first-run setup for Horus')
  .option('-y, --yes', 'Non-interactive mode (use defaults + env vars)')
  .option('--runtime <runtime>', 'Container runtime to use: docker or podman (non-interactive only)')
  .option('--data-dir <path>', 'Data directory path')
  .option('--repos-path <path>', 'Host repos path for Forge scanning')
  .option('--anvil-repo <url>', 'Anvil notes repository URL')
  .option('--vault-name <name>', 'Vault name (can be specified multiple times)')
  .option('--vault-repo <url>', 'Vault knowledge-base repository URL (matches positionally with --vault-name)')
  .option('--forge-repo <url>', 'Forge registry repository URL')
  .option('--github-token <token>', 'GitHub personal access token for private repos (primary host)')
  .option('--claude-desktop', 'Configure Claude Desktop MCP servers during setup (non-interactive opt-in)')
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

      // Parse vault names and repos from flags
      const vaultNames: string[] = opts.vaultName
        ? Array.isArray(opts.vaultName) ? opts.vaultName : [opts.vaultName]
        : ['default'];
      const vaultRepos: string[] = opts.vaultRepo
        ? Array.isArray(opts.vaultRepo) ? opts.vaultRepo : [opts.vaultRepo]
        : [process.env.VAULT_KNOWLEDGE_REPO_URL ?? ''];

      const vaults: Record<string, VaultConfig> = {};
      vaultNames.forEach((name, i) => {
        vaults[name] = {
          repo: vaultRepos[i] ?? vaultRepos[0] ?? '',
          default: i === 0,
        };
      });

      // Build github_hosts: map each unique hostname from vault repos + anvil repo
      const primaryToken = opts.githubToken || process.env.GITHUB_TOKEN || '';
      const anvilRepo = opts.anvilRepo || process.env.ANVIL_REPO_URL || defaults.repos.anvil_notes;
      const allRepoUrls = [anvilRepo, ...Object.values(vaults).map((v) => v.repo)].filter(Boolean);
      const seenHosts = new Set<string>();
      const github_hosts: Record<string, GitHubHost> = {};
      let hostIndex = 0;
      for (const url of allRepoUrls) {
        const hostname = extractHostname(url);
        if (!seenHosts.has(hostname)) {
          seenHosts.add(hostname);
          const hostKey = hostIndex === 0 ? 'default' : hostname;
          github_hosts[hostKey] = {
            host: hostname,
            token: primaryToken,
          };
          hostIndex++;
        }
      }
      // Ensure at least one github_host entry
      if (Object.keys(github_hosts).length === 0) {
        github_hosts['default'] = { host: 'github.com', token: primaryToken };
      }

      config = {
        ...defaults,
        runtime: runtime.name,
        data_dir: opts.dataDir || DEFAULT_DATA_DIR,
        host_repos_path: opts.reposPath || '',
        repos: {
          anvil_notes: anvilRepo,
          forge_registry: opts.forgeRepo || process.env.FORGE_REGISTRY_REPO_URL || defaults.repos.forge_registry,
        },
        vaults,
        github_hosts,
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
      // Repos are now auto-discovered recursively — no manual subdirectory prompt needed.
      const host_repos_extra_scan_dirs: string[] = [];

      const customize_ports = await confirm({
        message: 'Customize port assignments?',
        default: false,
      });

      let ports: { anvil: number; vault_rest: number; vault_mcp: number; vault_router: number; ui: number; forge: number; typesense: number; neo4j_http: number; neo4j_bolt: number } = { ...DEFAULT_PORTS };

      if (customize_ports) {
        const anvil = await number({
          message: 'Anvil port:',
          default: DEFAULT_PORTS.anvil,
        });
        const vault_rest = await number({
          message: 'Vault REST port (per-vault instances):',
          default: DEFAULT_PORTS.vault_rest,
        });
        const vault_mcp = await number({
          message: 'Vault MCP port:',
          default: DEFAULT_PORTS.vault_mcp,
        });
        const vault_router = await number({
          message: 'Vault Router port:',
          default: DEFAULT_PORTS.vault_router,
        });
        const forge = await number({
          message: 'Forge port:',
          default: DEFAULT_PORTS.forge,
        });
        ports = {
          anvil: anvil ?? DEFAULT_PORTS.anvil,
          vault_rest: vault_rest ?? DEFAULT_PORTS.vault_rest,
          vault_mcp: vault_mcp ?? DEFAULT_PORTS.vault_mcp,
          vault_router: vault_router ?? DEFAULT_PORTS.vault_router,
          ui: DEFAULT_PORTS.ui,
          forge: forge ?? DEFAULT_PORTS.forge,
          typesense: DEFAULT_PORTS.typesense,
          neo4j_http: DEFAULT_PORTS.neo4j_http,
          neo4j_bolt: DEFAULT_PORTS.neo4j_bolt,
        };
      }

      // Repository configuration
      console.log('');
      console.log(chalk.bold('Repository Configuration'));
      console.log(chalk.dim('Horus stores notes and knowledge in Git repos you own.'));
      console.log(chalk.dim('Create empty repos on your Git server, then paste the URLs below.'));
      console.log('');
      console.log(chalk.yellow('  Use HTTPS URLs — container services do not have SSH keys.'));
      console.log(chalk.dim('  SSH URLs (git@github.com:...) will fail at runtime inside Docker/Podman.'));
      console.log('');

      const primaryHost = await input({
        message: 'Primary Git server hostname:',
        default: 'github.com',
      });

      const example = (repo: string) => chalk.dim(`  e.g., https://${primaryHost}/<owner>/${repo}`);

      console.log('');

      const anvil_notes = await input({
        message: `Anvil notes repo URL:\n${example('horus-notes')}\n`,
        validate: (v) => v.trim().length > 0 || 'Anvil needs a notes repo to store your data.',
      });

      const forge_registry = await input({
        message: `Forge registry repo URL:\n${example('forge-registry')}\n`,
        validate: (v) => v.trim().length > 0 || 'Forge needs a registry repo.',
      });

      // Vault collection flow
      console.log('');
      console.log(chalk.bold('Vault Configuration'));
      console.log(chalk.dim('Add one or more knowledge-base vaults. Each vault is a separate Git repo.'));
      console.log('');

      const vaults: Record<string, VaultConfig> = {};
      let addingVaults = true;
      let isFirstVault = true;

      while (addingVaults) {
        const vaultName = await input({
          message: 'Add vault name (e.g., personal):',
          validate: (v) => {
            const trimmed = v.trim();
            if (!trimmed) return 'Vault name cannot be empty.';
            if (!/^[a-z0-9-]+$/.test(trimmed)) return 'Vault name must be lowercase alphanumeric with hyphens only.';
            if (trimmed in vaults) return `Vault "${trimmed}" already added.`;
            return true;
          },
        });

        const vaultRepo = await input({
          message: `Vault repo URL:\n${example(`${vaultName.trim()}-knowledge`)}\n`,
          validate: (v) => v.trim().length > 0 || 'Vault repo URL cannot be empty.',
        });

        let isDefault = isFirstVault;
        if (!isFirstVault) {
          isDefault = await confirm({
            message: `Is "${vaultName.trim()}" the default vault?`,
            default: false,
          });
        }

        // If user marks a new vault as default, unset any previous default
        if (isDefault) {
          for (const v of Object.values(vaults)) {
            v.default = false;
          }
        }

        vaults[vaultName.trim()] = {
          repo: vaultRepo.trim(),
          default: isDefault || isFirstVault,
        };
        isFirstVault = false;

        addingVaults = await confirm({
          message: 'Add another vault?',
          default: false,
        });
      }

      // Ensure exactly one default
      const defaultCount = Object.values(vaults).filter((v) => v.default).length;
      if (defaultCount === 0 && Object.keys(vaults).length > 0) {
        // Mark first vault as default
        const firstKey = Object.keys(vaults)[0];
        vaults[firstKey].default = true;
      }

      // Authentication: collect tokens per unique hostname
      console.log('');
      console.log(chalk.bold('Authentication'));
      console.log(chalk.dim('A personal access token is required per Git server for private repositories.'));
      console.log('');

      const allRepoUrls = [anvil_notes.trim(), ...Object.values(vaults).map((v) => v.repo)].filter(Boolean);
      const uniqueHostnames = [...new Set(allRepoUrls.map(extractHostname))];

      const github_hosts: Record<string, GitHubHost> = {};
      for (let i = 0; i < uniqueHostnames.length; i++) {
        const hostname = uniqueHostnames[i];
        const token = await password({
          message: `GitHub token for ${chalk.cyan(hostname)} (leave empty to skip):`,
          mask: '*',
        });
        const hostKey = i === 0 ? 'default' : hostname;
        github_hosts[hostKey] = {
          host: hostname,
          token: token.trim(),
        };
      }

      config = {
        ...defaultConfig(),
        data_dir,
        host_repos_path,
        host_repos_extra_scan_dirs,
        runtime: runtime.name,
        ports,
        repos: {
          anvil_notes: anvil_notes.trim(),
          forge_registry: forge_registry.trim(),
        },
        vaults,
        github_hosts,
      };
    }

    // Step 4: Save config
    const configSpinner = ora('Saving configuration...').start();
    try {
      saveConfig(config);
      configSpinner.succeed('Configuration saved to ~/Horus/config.yaml');
    } catch (error) {
      configSpinner.fail('Failed to save configuration');
      console.error((error as Error).message);
      process.exit(1);
    }

    // Step 5: Generate .env
    const envSpinner = ora('Generating .env file...').start();
    try {
      writeEnvFile(config);
      envSpinner.succeed('Environment file written to ~/Horus/.env');
    } catch (error) {
      envSpinner.fail('Failed to generate .env');
      console.error((error as Error).message);
      process.exit(1);
    }

    // Step 6: Install compose file (generated dynamically from config)
    const composeSpinner = ora('Installing docker-compose.yml...').start();
    try {
      installComposeFile(config, runtime.name);
      composeSpinner.succeed('Compose file installed to ~/Horus/docker-compose.yml');
    } catch (error) {
      composeSpinner.fail('Failed to install compose file');
      console.error((error as Error).message);
      process.exit(1);
    }

    // Step 7: Clone repos to data directory using host git credentials
    const dataDir = resolveConfigPath(config.data_dir);

    // Build list of repos to clone
    const anvilToken = resolveGitHubHost(config.repos.anvil_notes, config.github_hosts)?.token ?? '';
    const forgeToken = resolveGitHubHost(config.repos.forge_registry, config.github_hosts)?.token ?? '';

    const reposToClone: Array<{ url: string; dest: string; label: string; token: string }> = [
      {
        url: config.repos.anvil_notes,
        dest: join(dataDir, 'notes'),
        label: 'Anvil notes',
        token: anvilToken,
      },
      {
        url: config.repos.forge_registry,
        dest: join(dataDir, 'registry'),
        label: 'Forge registry',
        token: forgeToken,
      },
    ].filter((r) => r.url);

    // Add each vault repo
    for (const [name, vault] of Object.entries(config.vaults)) {
      if (vault.repo) {
        const vaultToken = resolveGitHubHost(vault.repo, config.github_hosts)?.token ?? '';
        reposToClone.push({
          url: vault.repo,
          dest: join(dataDir, 'vaults', name),
          label: `Vault: ${name}`,
          token: vaultToken,
        });
      }
    }

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
          const cloneUrl = injectToken(repo.url, repo.token);
          execSync(`git clone "${cloneUrl}" "${repo.dest}"`, {
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
          if (!repo.token) {
            console.log(chalk.dim('  Tip: Re-run setup and provide a GitHub token if the repo is private.'));
          }
          process.exit(1);
        }
      }
    }

    // Step 8: Pull images (non-fatal — images may not be published yet)
    console.log('');
    console.log(chalk.bold('Pulling container images...'));
    try {
      await composeStreaming(runtime, runtime.name === 'podman' ? ['pull'] : ['pull', '--ignore-pull-failures']);
    } catch {
      console.log(chalk.yellow('Some images could not be pulled.'));
      console.log(chalk.dim('Continuing — services will be built from source if build contexts are available.'));
    }

    // Step 9: Start services
    console.log('');
    console.log(chalk.bold('Starting Horus services...'));
    try {
      await composeStreaming(runtime, ['up', '-d', '--remove-orphans']);
    } catch (error) {
      console.log(chalk.red('Failed to start services.'));
      console.log(chalk.dim((error as Error).message));
      process.exit(1);
    }

    // Step 10: Poll health checks
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
      console.log(chalk.dim('Tip: Check logs with `docker compose logs` from ~/Horus/'));
      process.exit(1);
    }

    // Step 11: Configure AI clients
    console.log('');
    const detectedClients = detectInstalledClients();
    if (detectedClients.length > 0) {
      console.log(chalk.bold('Configuring AI clients...'));

      let clientsToConnect = [...detectedClients];

      // Claude Desktop requires an explicit opt-in: prompt in interactive mode,
      // flag-controlled in non-interactive mode.
      if (clientsToConnect.includes('claude-desktop')) {
        let configureDesktop: boolean;
        if (opts.yes) {
          configureDesktop = opts.claudeDesktop === true;
          if (!configureDesktop) {
            console.log(chalk.dim('Skipping Claude Desktop (pass --claude-desktop to configure it).'));
          }
        } else {
          configureDesktop = opts.claudeDesktop === false
            ? false
            : await confirm({ message: 'Setup for Claude Desktop?', default: true });
        }
        if (!configureDesktop) {
          clientsToConnect = clientsToConnect.filter((c) => c !== 'claude-desktop');
        }
      }

      if (clientsToConnect.length > 0) {
        try {
          await runConnect(config, runtime, clientsToConnect, 'localhost');
        } catch (error) {
          console.log(chalk.yellow('Could not configure AI clients automatically.'));
          console.log(chalk.dim(`Run ${chalk.cyan('horus connect')} to configure them manually.`));
        }
      }
    } else {
      console.log(chalk.dim(`No AI clients detected. Run ${chalk.cyan('horus connect')} after installing Claude Desktop, Claude Code, or Cursor.`));
    }

    // Step 12: Print success summary
    console.log('');
    console.log(chalk.bold.green('Setup complete!'));
    console.log(chalk.dim('──────────────────────────────────────'));
    console.log('');
    console.log(`  ${chalk.bold('Runtime:')}    ${runtime.name}`);
    console.log(`  ${chalk.bold('Config:')}     ~/Horus/config.yaml`);
    console.log(`  ${chalk.bold('Data:')}       ${config.data_dir}`);
    console.log('');
    console.log(chalk.bold('  Service URLs:'));
    console.log(`    Anvil:        http://localhost:${config.ports.anvil}`);
    console.log(`    Vault Router: http://localhost:${config.ports.vault_router}`);
    console.log(`    Vault MCP:    http://localhost:${config.ports.vault_mcp}`);
    console.log(`    Forge:        http://localhost:${config.ports.forge}`);
    console.log('');
    console.log(chalk.bold('  Vault instances:'));
    Object.entries(config.vaults).sort(([a], [b]) => a.localeCompare(b)).forEach(([name, vault], index) => {
      const port = `800${index + 1}`;
      const defaultLabel = vault.default ? chalk.dim(' (default)') : '';
      console.log(`    ${name}${defaultLabel}:  http://localhost:${port}`);
    });
    console.log('');

    // Suppress unused variable warning for lastStates
    void lastStates;
  });
