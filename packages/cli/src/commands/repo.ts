import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, configExists } from '../lib/config.js';
import { RepoRegistryClient } from '@forge/core';
import { migrateRepos } from '../lib/repo-migrate.js';

// ── repo command ─────────────────────────────────────────────────────────────

export const repoCommand = new Command('repo')
  .description('Manage the Forge repository index');

// ── repo migrate subcommand ───────────────────────────────────────────────────

repoCommand
  .command('migrate')
  .description('Import existing repos.json entries into the shared repo registry')
  .option('--from <path>', 'Path to repos.json (default: ~/Horus/data/config/repos.json)')
  .option('--registry <url>', 'Shared registry base URL (overrides enterprise_registry_url)')
  .option('--dry-run', 'Preview what would be migrated without writing to the registry')
  .action(async (opts: { from?: string; registry?: string; dryRun?: boolean }) => {
    console.log('');
    console.log(chalk.bold('Horus Repo Migrate'));
    console.log(chalk.dim('──────────────────────────────────────'));
    console.log('');

    if (!configExists()) {
      console.log(chalk.red('Horus is not set up yet.'));
      console.log(chalk.dim('Run `horus setup` first.'));
      process.exit(1);
    }

    const config = loadConfig();

    // Build the shared registry base URL: explicit --registry flag wins, then
    // the configured enterprise_registry_url, then the control-plane Forge
    // registry derived from control_plane_url. There is no localhost fallback —
    // the repo registry is the shared, deployed one.
    const cpRegistryUrl = config.control_plane_url
      ? `${config.control_plane_url.replace(/\/$/, '')}/api/v1/forge`
      : undefined;
    const registryUrl = opts.registry ?? config.enterprise_registry_url ?? cpRegistryUrl;

    if (!registryUrl) {
      console.log(chalk.red('No shared repo registry is configured.'));
      console.log(chalk.dim('Connect to a control plane (`horus connect`) or pass `--registry <url>`.'));
      process.exit(1);
    }

    const client = new RepoRegistryClient({ baseUrl: registryUrl });

    if (opts.dryRun) {
      console.log(chalk.yellow('  Dry-run mode — no changes will be written to the registry.'));
      console.log('');
    }

    const spinner = ora('Reading repos.json...').start();

    let migrateResult: Awaited<ReturnType<typeof migrateRepos>>;
    try {
      migrateResult = await migrateRepos({
        from: opts.from,
        dryRun: opts.dryRun,
        client,
      });
    } catch (err: unknown) {
      spinner.fail('Migration failed');
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }

    spinner.stop();

    const total =
      migrateResult.migrated.length +
      migrateResult.skipped.length +
      migrateResult.failed.length;

    console.log(
      `Migrated ${chalk.bold(String(migrateResult.migrated.length))}/${total} repos:`,
    );
    console.log('');

    for (const repo of migrateResult.migrated) {
      console.log(`  ${chalk.green('✅')} ${repo}`);
    }
    for (const { repo, reason } of migrateResult.skipped) {
      console.log(`  ${chalk.yellow('⚠️ ')} ${repo} ${chalk.dim(`(skipped — ${reason})`)}`);
    }
    for (const { repo, error } of migrateResult.failed) {
      console.log(`  ${chalk.red('❌')} ${repo} ${chalk.dim(`(failed — ${error})`)}`);
    }

    console.log('');

    if (migrateResult.failed.length > 0) {
      process.exit(1);
    }
  });
