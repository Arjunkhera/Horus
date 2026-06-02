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
  writeForgeConfigFile,
  ensureDataDirs,
  configExists,
  defaultConfig,
  resolveConfigPath,
  loadPreprovisionedConfig,
  detectPreprovisionedConfig,
  ensureFsLayout,
  type Config,
} from '../lib/config.js';
import { checkRuntime, detectRuntime, composeStreaming } from '../lib/runtime.js';
import { pollUntilHealthy, type ServiceHealth } from '../lib/health.js';
import { installComposeFile } from '../lib/compose.js';
import { DEFAULT_PORTS, DEFAULT_DATA_DIR } from '../lib/constants.js';
import { runConnect, detectInstalledClients } from './connect.js';
import { runLogin } from './login.js';

// ── Setup command ───────────────────────────────────────────────────────────

export const setupCommand = new Command('setup')
  .description('First-run setup for the Horus client')
  .option('-y, --yes', 'Non-interactive mode (use defaults + env vars)')
  .option('--local-only', 'Local-only mode: skip the control-plane / login prompts')
  .option('--config <path>', 'Provision from a pre-provisioned, zod-validated config.yaml bundle')
  .option('--no-pull', 'Skip pulling container images')
  .option('--runtime <runtime>', 'Container runtime to use: docker or podman')
  .option('--data-dir <path>', 'Data directory path')
  .option('--anvil-repo <url>', 'Anvil notes repository URL (HTTPS)')
  .option('--control-plane <url>', 'Control-plane base URL (connected mode)')
  .option('--claude-desktop', 'Configure Claude Desktop MCP servers during setup')
  .action(async (opts) => {
    console.log('');
    console.log(chalk.bold('Horus Setup'));
    console.log(chalk.dim('──────────────────────────────────────'));
    console.log('');

    // Resolve which provisioning mode we are in.
    const preprovisionedPath: string | null = opts.config ?? detectPreprovisionedConfig();
    const isPreprovisioned = !!preprovisionedPath;
    const isYes = !!opts.yes;
    const isLocalOnly = !!opts.localOnly;
    const interactive = !isPreprovisioned && !isYes;

    // Reconfigure guard (converge, never clobber silently).
    if (configExists() && interactive) {
      const proceed = await confirm({
        message: 'Horus is already configured. Reconfigure? (existing data is preserved)',
        default: false,
      });
      if (!proceed) {
        console.log(chalk.dim('Setup cancelled.'));
        return;
      }
    }

    // Detect available container runtimes.
    const checkSpinner = ora('Checking for container runtimes...').start();
    const [hasDocker, hasPodman] = await Promise.all([checkRuntime('docker'), checkRuntime('podman')]);
    checkSpinner.stop();
    const available = [
      ...(hasDocker ? ['docker' as const] : []),
      ...(hasPodman ? ['podman' as const] : []),
    ];
    if (available.length === 0) {
      console.log(chalk.red('No container runtime found.'));
      console.log('');
      console.log('Horus requires Docker or Podman with the Compose plugin.');
      console.log('  Docker Desktop: https://www.docker.com/products/docker-desktop/');
      console.log('  Podman Desktop: https://podman-desktop.io/');
      process.exit(1);
    }

    // ── Build the config for this run ────────────────────────────────────────
    let config: Config;
    let selectedRuntime: 'docker' | 'podman';

    if (isPreprovisioned) {
      // --config <path> / auto-detected bundle: zod-validate and adopt.
      const loadSpinner = ora(`Loading pre-provisioned config: ${preprovisionedPath}`).start();
      try {
        config = loadPreprovisionedConfig(preprovisionedPath!);
        loadSpinner.succeed('Pre-provisioned config validated');
      } catch (err) {
        loadSpinner.fail('Pre-provisioned config is invalid');
        console.log(chalk.red((err as Error).message));
        process.exit(1);
      }
      const requested = (opts.runtime as 'docker' | 'podman' | undefined) ?? config!.runtime;
      selectedRuntime = available.includes(requested) ? requested : available[0];
    } else if (isYes) {
      // Non-interactive: defaults + env + existing config.
      const existing = configExists() ? loadConfig() : null;
      const defaults = defaultConfig();
      const requested = opts.runtime as 'docker' | 'podman' | undefined;
      if (requested && !available.includes(requested)) {
        console.log(chalk.red(`Requested runtime "${requested}" is not installed.`));
        process.exit(1);
      }
      selectedRuntime = requested ?? existing?.runtime ?? available[0];

      const controlPlane = opts.controlPlane || process.env.HORUS_CONTROL_PLANE_URL || existing?.control_plane_url || '';
      config = {
        ...defaults,
        ...(existing ?? {}),
        runtime: selectedRuntime,
        data_dir: opts.dataDir || existing?.data_dir || DEFAULT_DATA_DIR,
        control_plane_url: controlPlane,
        token_provider: {
          kind: process.env.TOKEN_PROVIDER_KIND || existing?.token_provider?.kind || (controlPlane ? 'static' : ''),
          config: process.env.TOKEN_PROVIDER_CONFIG || existing?.token_provider?.config || '',
        },
        repos: {
          anvil_notes: opts.anvilRepo || process.env.ANVIL_REPO_URL || existing?.repos.anvil_notes || '',
          forge_registry: existing?.repos.forge_registry || '',
        },
        ai: {
          key: process.env.HORUS_AI_KEY || existing?.ai.key || '',
          anthropic_api_key: process.env.HORUS_ANTHROPIC_API_KEY || existing?.ai.anthropic_api_key || '',
          model: process.env.HORUS_AGENT_MODEL || existing?.ai.model || defaults.ai.model,
        },
      };
    } else {
      // Interactive — runtime prompt first.
      selectedRuntime = available.length === 1
        ? available[0]
        : await select({
            message: 'Which container runtime would you like to use?',
            choices: available.map((r) => ({ value: r, name: r === 'docker' ? 'Docker' : 'Podman' })),
          });

      const defaults = defaultConfig();
      let control_plane_url = '';
      let token_provider = { kind: '', config: '' };

      if (!isLocalOnly) {
        // (1) Control-plane URL — soft-warn if unreachable, NEVER fatal.
        control_plane_url = (
          await input({
            message: 'Control-plane URL (leave empty for local-only):',
            default: opts.controlPlane ?? '',
          })
        ).trim();

        if (control_plane_url) {
          const cpSpinner = ora(`Checking control plane at ${control_plane_url}...`).start();
          try {
            const res = await fetch(control_plane_url.replace(/\/$/, '') + '/health', {
              signal: AbortSignal.timeout(8_000),
            });
            if (res.ok) cpSpinner.succeed('Control plane reachable');
            else cpSpinner.warn(`Control plane responded HTTP ${res.status} — continuing (login can be deferred)`);
          } catch {
            cpSpinner.warn('Control plane unreachable — continuing; run `horus login` later');
          }

          // (2) TokenProvider flavor.
          const kind = await select({
            message: 'Principal token provider:',
            choices: [
              { value: 'static', name: 'Static token (paste a token)' },
              { value: 'oidc', name: 'OIDC (issuer URL; login completes against the control plane)' },
              { value: 'none', name: 'None (anonymous / configure later)' },
            ],
          });

          // (3) Provider config.
          let providerConfig = '';
          if (kind === 'static') {
            providerConfig = (await password({ message: 'Principal token:', mask: '*' })).trim();
          } else if (kind === 'oidc') {
            providerConfig = (await input({ message: 'OIDC issuer URL:' })).trim();
          }
          token_provider = { kind, config: providerConfig };
        }
      } else {
        console.log(chalk.dim('Local-only mode — skipping control-plane and login prompts.'));
      }

      // (5) Anvil git repo (optional).
      const anvil_notes = (
        await input({
          message: 'Anvil notes repo URL (HTTPS, optional — leave empty to start with an empty local notes dir):',
          default: opts.anvilRepo ?? '',
        })
      ).trim();

      // (6) Data dir.
      const data_dir = await input({ message: 'Data directory:', default: opts.dataDir ?? DEFAULT_DATA_DIR });

      // (agent key — optional; chat surface is disabled when empty)
      const anthropicKey = (
        await password({ message: 'Anthropic API key for agent chat (leave empty to skip):', mask: '*' })
      ).trim();

      // (7) Ports?
      let ports: Config['ports'] = { ...DEFAULT_PORTS };
      const customizePorts = await confirm({ message: 'Customize port assignments?', default: false });
      if (customizePorts) {
        const anvil = await number({ message: 'Anvil port:', default: DEFAULT_PORTS.anvil });
        const ui = await number({ message: 'Horus UI port:', default: DEFAULT_PORTS.ui });
        const typesense = await number({ message: 'Typesense port:', default: DEFAULT_PORTS.typesense });
        const neo4j_http = await number({ message: 'Neo4j HTTP port:', default: DEFAULT_PORTS.neo4j_http });
        const neo4j_bolt = await number({ message: 'Neo4j Bolt port:', default: DEFAULT_PORTS.neo4j_bolt });
        ports = {
          ...ports,
          anvil: anvil ?? DEFAULT_PORTS.anvil,
          ui: ui ?? DEFAULT_PORTS.ui,
          typesense: typesense ?? DEFAULT_PORTS.typesense,
          neo4j_http: neo4j_http ?? DEFAULT_PORTS.neo4j_http,
          neo4j_bolt: neo4j_bolt ?? DEFAULT_PORTS.neo4j_bolt,
        };
      }

      config = {
        ...defaults,
        runtime: selectedRuntime,
        data_dir,
        ports,
        control_plane_url,
        token_provider,
        repos: { anvil_notes, forge_registry: '' },
        ai: { key: '', anthropic_api_key: anthropicKey, model: defaults.ai.model },
      };
    }

    const runtime = await detectRuntime(selectedRuntime);
    config.runtime = runtime.name;

    // ── Persist config + provision the filesystem ────────────────────────────
    const configSpinner = ora('Saving configuration...').start();
    try {
      saveConfig(config);
      ensureFsLayout(); // providers/, logs/, keys/
      ensureDataDirs(config); // data/{config,sessions,repos,workspaces} — user-owned, before any container runs
      configSpinner.succeed('Configuration saved to ~/Horus/config.yaml (providers/, logs/, keys/ ready)');
    } catch (error) {
      configSpinner.fail('Failed to save configuration');
      console.error((error as Error).message);
      process.exit(1);
    }

    const envSpinner = ora('Generating .env file...').start();
    try {
      writeEnvFile(config);
      envSpinner.succeed('Environment file written to ~/Horus/.env');
    } catch (error) {
      envSpinner.fail('Failed to generate .env');
      console.error((error as Error).message);
      process.exit(1);
    }

    // Wire the embedded Forge engine's registry to the control plane. Without a
    // forge.yaml, @forge/core falls back to dead default registries and every
    // workspace-config artifact fetch fails. Non-destructive: a hand-edited
    // forge.yaml (managed marker removed) is left untouched.
    const forgeSpinner = ora('Configuring Forge registry...').start();
    try {
      const forgeRes = writeForgeConfigFile(config);
      if (forgeRes.written) {
        forgeSpinner.succeed(
          config.control_plane_url
            ? 'Forge registry pointed at the control plane (~/Horus/data/config/forge.yaml)'
            : 'Forge config written (local-only; no remote registry) (~/Horus/data/config/forge.yaml)',
        );
      } else {
        forgeSpinner.info('Existing forge.yaml is hand-managed — left untouched');
      }
    } catch (error) {
      // Non-fatal: a forge.yaml write failure must not abort setup (the rest of
      // the stack still comes up). The common cause is a root-owned data/config
      // dir on an existing install (Docker created it on a prior `up`), which the
      // user-run CLI cannot write into — surface a concrete remediation.
      const err = error as NodeJS.ErrnoException;
      if (err?.code === 'EACCES' || err?.code === 'EPERM') {
        forgeSpinner.warn('Could not write forge.yaml — ~/Horus/data/config is not writable by the current user.');
        console.log(
          chalk.dim(
            `  Forge workspace creation needs this file. Fix ownership and re-run setup:\n` +
              `    sudo chown -R "$(id -un)" "${resolveConfigPath(config.data_dir)}" && horus setup -y`,
          ),
        );
      } else {
        forgeSpinner.warn(`Could not write forge.yaml: ${err?.message ?? String(error)}`);
      }
    }

    const composeSpinner = ora('Installing docker-compose.yml...').start();
    try {
      installComposeFile(config, runtime.name);
      composeSpinner.succeed('Compose file installed to ~/Horus/docker-compose.yml');
    } catch (error) {
      composeSpinner.fail('Failed to install compose file');
      console.error((error as Error).message);
      process.exit(1);
    }

    // ── Clone the Anvil notes repo (optional, idempotent) ────────────────────
    const dataDir = resolveConfigPath(config.data_dir);
    mkdirSync(dataDir, { recursive: true });
    const notesDest = join(dataDir, 'notes');
    if (config.repos.anvil_notes) {
      const spinner = ora('Cloning Anvil notes...').start();
      if (existsSync(join(notesDest, '.git'))) {
        spinner.succeed('Anvil notes already cloned');
      } else {
        try {
          mkdirSync(notesDest, { recursive: true });
          // Clone runs on the host, using host git credentials (SSH/helper).
          execSync(`git clone "${config.repos.anvil_notes}" "${notesDest}"`, { stdio: 'pipe', timeout: 60_000 });
          spinner.succeed('Anvil notes cloned');
        } catch (error) {
          spinner.fail('Failed to clone Anvil notes (continuing with an empty notes dir)');
          console.log(chalk.dim(`  ${((error as Error).message || '').split('\n')[0]}`));
          console.log(chalk.dim(`  URL: ${config.repos.anvil_notes}`));
          mkdirSync(notesDest, { recursive: true });
        }
      }
    } else {
      mkdirSync(notesDest, { recursive: true });
    }

    // ── Pull images (unless --no-pull) — non-fatal ───────────────────────────
    if (opts.pull !== false) {
      console.log('');
      console.log(chalk.bold('Pulling container images...'));
      try {
        await composeStreaming(runtime, runtime.name === 'podman' ? ['pull'] : ['pull', '--ignore-pull-failures']);
      } catch {
        console.log(chalk.yellow('Some images could not be pulled — continuing.'));
      }
    } else {
      console.log(chalk.dim('Skipping image pull (--no-pull).'));
    }

    // ── Start services ───────────────────────────────────────────────────────
    console.log('');
    console.log(chalk.bold('Starting Horus services...'));
    try {
      await composeStreaming(runtime, ['up', '-d', '--remove-orphans']);
    } catch (error) {
      console.log(chalk.red('Failed to start services.'));
      console.log(chalk.dim((error as Error).message));
      process.exit(1);
    }

    // ── Health poll ───────────────────────────────────────────────────────────
    console.log('');
    const healthSpinner = ora('Waiting for services to become healthy...').start();
    let lastStates: ServiceHealth[] = [];
    try {
      lastStates = await pollUntilHealthy(
        runtime,
        (current) => {
          lastStates = current;
          const summary = current
            .map((s) => {
              const icon = s.status === 'healthy' ? chalk.green('*') : s.status === 'starting' ? chalk.yellow('~') : chalk.red('x');
              return `${icon} ${s.name}`;
            })
            .join('  ');
          healthSpinner.text = `Waiting for services...  ${summary}`;
        },
        600_000,
        5_000,
      );
      healthSpinner.succeed('All services are healthy');
    } catch (error) {
      healthSpinner.fail('Some services did not become healthy');
      console.log(chalk.dim((error as Error).message));
      console.log(chalk.dim('Tip: check logs with `horus status` or `docker compose logs` from ~/Horus/'));
      // Non-fatal: the UI may still be browsable; continue to login/connect.
    }

    // ── Login (connected only, non-fatal, at the end) ─────────────────────────
    if (config.control_plane_url) {
      console.log('');
      const loginSpinner = ora('Logging in to the control plane...').start();
      const result = await runLogin(config);
      if (result.ok) loginSpinner.succeed(result.message);
      else loginSpinner.warn(result.message);
    }

    // ── Configure MCP clients ──────────────────────────────────────────────────
    console.log('');
    const detectedClients = detectInstalledClients();
    if (detectedClients.length > 0) {
      console.log(chalk.bold('Configuring AI clients...'));
      let clientsToConnect = [...detectedClients];
      if (clientsToConnect.includes('claude-desktop')) {
        let configureDesktop: boolean;
        if (!interactive) {
          configureDesktop = opts.claudeDesktop === true;
        } else {
          configureDesktop = opts.claudeDesktop === false
            ? false
            : await confirm({ message: 'Setup for Claude Desktop?', default: true });
        }
        if (!configureDesktop) clientsToConnect = clientsToConnect.filter((c) => c !== 'claude-desktop');
      }
      if (clientsToConnect.length > 0) {
        try {
          await runConnect(config, runtime, clientsToConnect, 'localhost');
        } catch {
          console.log(chalk.yellow('Could not configure AI clients automatically.'));
          console.log(chalk.dim(`Run ${chalk.cyan('horus connect')} to configure them manually.`));
        }
      }
    } else {
      console.log(chalk.dim(`No AI clients detected. Run ${chalk.cyan('horus connect')} after installing one.`));
    }

    // ── Summary ────────────────────────────────────────────────────────────────
    const mode = config.control_plane_url ? 'connected' : 'local-only';
    console.log('');
    console.log(chalk.bold.green('Setup complete!'));
    console.log(chalk.dim('──────────────────────────────────────'));
    console.log('');
    console.log(`  ${chalk.bold('Mode:')}       ${mode}`);
    console.log(`  ${chalk.bold('Runtime:')}    ${runtime.name}`);
    console.log(`  ${chalk.bold('Config:')}     ~/Horus/config.yaml`);
    console.log(`  ${chalk.bold('Data:')}       ${config.data_dir}`);
    if (config.control_plane_url) {
      console.log(`  ${chalk.bold('Control plane:')} ${config.control_plane_url}`);
    }
    console.log('');
    console.log(chalk.bold('  Service URLs:'));
    console.log(`    Horus UI:  http://localhost:${config.ports.ui}`);
    console.log(`    Anvil:     http://localhost:${config.ports.anvil}`);
    console.log('');
    if (mode === 'local-only') {
      console.log(chalk.dim('  Vault, Forge, and Admin require a control plane — not available in local-only mode.'));
      console.log('');
    }

    void lastStates;
  });
