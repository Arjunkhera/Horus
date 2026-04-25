import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, configExists } from '../lib/config.js';

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
