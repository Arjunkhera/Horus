import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, configExists } from '../lib/config.js';
import { RepoRegistryClient } from '@forge/core';
import { migrateRepos } from '../lib/repo-migrate.js';

// ── repo command ─────────────────────────────────────────────────────────────

export const repoCommand = new Command('repo')
  .description('Manage the Forge repository index');

repoCommand
  .command('rindex')
  .alias('scan')
  .description('Trigger a full repository index rescan via Forge')
  .action(async () => {
    if (!configExists()) {
      console.log(chalk.red('Horus is not set up yet.'));
      console.log(chalk.dim('Run `horus setup` first.'));
      process.exit(1);
    }

    const config = loadConfig();
    const forgePort = config.ports.forge ?? 8200;
    const forgeUrl = `http://localhost:${forgePort}/mcp`;

    const spinner = ora('Scanning repositories...').start();

    let body: string;
    try {
      const res = await fetch(forgeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'forge_repo_scan', arguments: {} },
        }),
      });

      body = await res.text();

      if (!res.ok) {
        spinner.fail(`Forge returned HTTP ${res.status}`);
        console.error(chalk.red(body));
        process.exit(1);
      }
    } catch (err) {
      spinner.fail('Could not reach Forge');
      console.error(chalk.red(`Is Horus running? (horus up)`));
      console.error(chalk.dim((err as Error).message));
      process.exit(1);
    }

    let parsed: { result?: { content?: Array<{ text?: string }> }; error?: { message?: string } };
    try {
      parsed = JSON.parse(body);
    } catch {
      spinner.fail('Unexpected response from Forge');
      console.error(body);
      process.exit(1);
    }

    if (parsed.error) {
      spinner.fail('Scan failed');
      console.error(chalk.red(parsed.error.message ?? JSON.stringify(parsed.error)));
      process.exit(1);
    }

    let result: { scanPaths?: string[]; reposFound?: number; repos?: Array<{ name: string; localPath: string }> } = {};
    try {
      const text = parsed.result?.content?.[0]?.text ?? '{}';
      result = JSON.parse(text);
    } catch {
      // non-JSON response — just show raw
    }

    spinner.succeed('Repository scan complete');
    console.log('');
    console.log(`  ${chalk.bold('Scan paths:')}  ${(result.scanPaths ?? []).length}`);
    console.log(`  ${chalk.bold('Repos found:')} ${result.reposFound ?? 0}`);

    if (result.repos && result.repos.length > 0) {
      console.log('');
      for (const repo of result.repos) {
        console.log(`  ${chalk.green('✓')} ${chalk.bold(repo.name)}  ${chalk.dim(repo.localPath)}`);
      }
    }
    console.log('');
  });

// ── repo migrate subcommand ───────────────────────────────────────────────────

repoCommand
  .command('migrate')
  .description('Import existing repos.json entries into the remote repo registry')
  .option('--from <path>', 'Path to repos.json (default: ~/Horus/data/config/repos.json)')
  .option('--dry-run', 'Preview what would be migrated without writing to the registry')
  .action(async (opts: { from?: string; dryRun?: boolean }) => {
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

    // Build the registry base URL: enterprise_registry_url takes precedence,
    // then fall back to the default local registry-service port (8744).
    const registryUrl = config.enterprise_registry_url ?? 'http://localhost:8744';

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
