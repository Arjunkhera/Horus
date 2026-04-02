#!/usr/bin/env node
import { Command } from 'commander';
import { ForgeCore, loadGlobalConfig, saveGlobalConfig, addGlobalRegistry, removeGlobalRegistry, GLOBAL_CONFIG_PATH } from '@forge/core';
import { RegistryConfigSchema } from '@forge/core';
import chalk from 'chalk';
import Table from 'cli-table3';
import { promises as fs } from 'fs';
import * as readline from 'readline';

const program = new Command();

program
  .name('forge')
  .description('Package manager and compiler for AI agent workspaces')
  .version('0.1.0')
  .option('--config <path>', 'Path to forge.yaml', process.env.FORGE_WORKSPACE_PATH ?? process.cwd());

// forge init <name>
program
  .command('init <name>')
  .description('Initialize a new Forge workspace')
  .action(async (name: string, options: any) => {
    const forge = new ForgeCore(program.opts().config);
    try {
      await forge.init(name);
      console.log(chalk.green(`✓ Initialized workspace '${name}'`));
      console.log(`  Created forge.yaml and forge.lock`);
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      if (err.suggestion) console.error(chalk.gray(`  Hint: ${err.suggestion}`));
      process.exit(1);
    }
  });

// forge add <refs...>
program
  .command('add <refs...>')
  .description('Add one or more artifacts to forge.yaml (e.g., skill:developer@1.0.0)')
  .action(async (refs: string[]) => {
    const forge = new ForgeCore(program.opts().config);
    try {
      const config = await forge.add(refs);
      console.log(chalk.green(`✓ Added ${refs.join(', ')}`));
      const skillCount = Object.keys(config.artifacts.skills).length;
      const agentCount = Object.keys(config.artifacts.agents).length;
      console.log(`  Skills: ${skillCount}, Agents: ${agentCount}`);
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      if (err.suggestion) console.error(chalk.gray(`  Hint: ${err.suggestion}`));
      process.exit(1);
    }
  });

// forge install [--target <target>]
program
  .command('install')
  .description('Install all artifacts from forge.yaml into the workspace')
  .option('-t, --target <target>', 'Compile target (claude-code|cursor|plugin)', 'claude-code')
  .option('--dry-run', 'Preview changes without writing files')
  .option('--conflict <strategy>', 'Conflict strategy (overwrite|skip|backup)', 'backup')
  .action(async (options: { target: string; dryRun: boolean; conflict: string }) => {
    const forge = new ForgeCore(program.opts().config);
    try {
      const report = await forge.install({
        target: options.target as any,
        dryRun: options.dryRun,
        conflictStrategy: options.conflict as any,
      });
      if (options.dryRun) {
        console.log(chalk.yellow('Dry run — no files written'));
      } else {
        console.log(chalk.green(`✓ Installed ${report.installed.length} artifact(s) in ${report.duration}ms`));
      }
      console.log(`  Files: ${report.filesWritten.length} written, ${report.conflicts.length} conflicts`);
      for (const f of report.filesWritten) {
        console.log(chalk.gray(`    + ${f}`));
      }
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      if (err.suggestion) console.error(chalk.gray(`  Hint: ${err.suggestion}`));
      process.exit(1);
    }
  });

// forge search <query> [--type <type>]
program
  .command('search <query>')
  .description('Search the registry for artifacts')
  .option('-t, --type <type>', 'Filter by type (skill|agent|plugin|workspace-config)')
  .action(async (query: string, options: { type?: string }) => {
    const forge = new ForgeCore(program.opts().config);
    try {
      const results = await forge.search(query, options.type as any);
      if (results.length === 0) {
        console.log(chalk.yellow(`No results for '${query}'`));
        return;
      }
      const table = new Table({
        head: [chalk.bold('Type'), chalk.bold('ID'), chalk.bold('Version'), chalk.bold('Description')],
        colWidths: [20, 20, 10, 50],
      });
      for (const r of results) {
        table.push([r.ref.type, r.ref.id, r.ref.version, r.meta.description.slice(0, 47) + (r.meta.description.length > 47 ? '...' : '')]);
      }
      console.log(table.toString());
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

// forge list [--installed | --available]
program
  .command('list')
  .description('List artifacts')
  .option('--installed', 'Show only installed artifacts')
  .option('--available', 'Show available artifacts in registry')
  .option('-t, --type <type>', 'Filter by type (skill|agent|plugin|workspace-config)')
  .action(async (options: { installed?: boolean; available?: boolean; type?: string }) => {
    const forge = new ForgeCore(program.opts().config);
    const scope = options.installed ? 'installed' : 'available';
    try {
      const summaries = await forge.list(scope, options.type as any);
      if (summaries.length === 0) {
        console.log(chalk.yellow(`No ${scope} artifacts found`));
        return;
      }
      const table = new Table({
        head: [chalk.bold('Type'), chalk.bold('ID'), chalk.bold('Version'), chalk.bold('Name')],
        colWidths: [20, 25, 10, 35],
      });
      for (const s of summaries) {
        table.push([s.ref.type, s.ref.id, s.ref.version, s.name]);
      }
      console.log(table.toString());
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

// forge show <ref>
program
  .command('show <ref>')
  .description('Show detailed info about an artifact (e.g., skill:developer)')
  .action(async (refStr: string) => {
    const forge = new ForgeCore(program.opts().config);
    try {
      const resolved = await forge.resolve(refStr);
      const { meta } = resolved.bundle;
      console.log(chalk.bold(`\n${meta.name}`));
      console.log(`  ID:          ${meta.id}`);
      console.log(`  Type:        ${meta.type}`);
      console.log(`  Version:     ${meta.version}`);
      console.log(`  Description: ${meta.description}`);
      if (meta.tags.length > 0) {
        console.log(`  Tags:        ${meta.tags.join(', ')}`);
      }

      // Show workspace-config specific fields
      if (meta.type === 'workspace-config') {
        if (Object.keys(meta.mcp_servers).length > 0) {
          const serverList = Object.entries(meta.mcp_servers)
            .map(([name, config]) => `${name}${config.required ? ' (required)' : ' (optional)'}`)
            .join(', ');
          console.log(`  MCP Servers: ${serverList}`);
        }
        if (meta.plugins.length > 0) {
          console.log(`  Plugins:     ${meta.plugins.join(', ')}`);
        }
        if (meta.skills.length > 0) {
          console.log(`  Skills:      ${meta.skills.join(', ')}`);
        }
        if (Object.keys(meta.git_workflow).length > 0) {
          const gwc = meta.git_workflow;
          console.log(`  Git Workflow: branch=${gwc.branch_pattern}, base=${gwc.base_branch}, format=${gwc.commit_format}`);
        }
      }

      if (resolved.dependencies.length > 0) {
        console.log(`  Deps:        ${resolved.dependencies.map(d => d.ref.id).join(', ')}`);
      }
      console.log();
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      if (err.suggestion) console.error(chalk.gray(`  Hint: ${err.suggestion}`));
      process.exit(1);
    }
  });

// forge remove <refs...>
program
  .command('remove <refs...>')
  .description('Remove artifacts from forge.yaml')
  .action(async (refs: string[]) => {
    const forge = new ForgeCore(program.opts().config);
    try {
      await forge.remove(refs);
      console.log(chalk.green(`✓ Removed ${refs.join(', ')}`));
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

// forge repo — repository index management
const repo = program.command('repo').description('Manage the local git repository index');

repo
  .command('scan')
  .description('Scan configured directories for git repositories')
  .action(async () => {
    const forge = new ForgeCore(program.opts().config);
    try {
      const index = await forge.repoScan();
      console.log(chalk.green(`✓ Scanned ${index.scanPaths.length} path(s), found ${index.repos.length} repositories`));
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      if (err.suggestion) console.error(chalk.gray(`  Hint: ${err.suggestion}`));
      process.exit(1);
    }
  });

repo
  .command('list')
  .description('List all indexed repositories')
  .option('-q, --query <query>', 'filter by name or URL')
  .option('-l, --language <lang>', 'filter by language')
  .action(async (options: { query?: string; language?: string }) => {
    const forge = new ForgeCore(program.opts().config);
    try {
      let repos = await forge.repoList(options.query);
      if (options.language) {
        repos = repos.filter(r => r.language?.toLowerCase() === options.language!.toLowerCase());
      }
      if (repos.length === 0) {
        console.log('No repositories found. Run: forge repo scan');
        return;
      }
      const table = new Table({
        head: [chalk.bold('Name'), chalk.bold('Path'), chalk.bold('Language'), chalk.bold('Last Commit')],
        colWidths: [25, 35, 15, 15],
      });
      for (const r of repos) {
        table.push([r.name, r.localPath, r.language ?? '—', r.lastCommitDate.slice(0, 10)]);
      }
      console.log(table.toString());
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

repo
  .command('show <name>')
  .description('Show details for a single repository')
  .action(async (name: string) => {
    const forge = new ForgeCore(program.opts().config);
    try {
      const result = await forge.repoResolve({ name });
      if (result.ambiguous) {
        console.error(`Multiple repositories named '${name}' found:`);
        for (const m of result.allMatches) {
          console.error(`  - ${m.localPath} (${m.remoteUrl ?? 'no remote'})`);
        }
        console.error('Use the full path or remote URL to disambiguate.');
        process.exit(1);
      }
      const entry = result.match;
      if (!entry) {
        console.error(`Repository '${name}' not found. Run: forge repo scan`);
        process.exit(1);
      }
      console.log(`Name:         ${entry.name}`);
      console.log(`Path:         ${entry.localPath}`);
      console.log(`Remote:       ${entry.remoteUrl ?? '(none)'}`);
      console.log(`Branch:       ${entry.defaultBranch}`);
      console.log(`Language:     ${entry.language ?? '—'}`);
      console.log(`Framework:    ${entry.framework ?? '—'}`);
      console.log(`Last Commit:  ${entry.lastCommitDate}`);
      console.log(`Last Scanned: ${entry.lastScannedAt}`);
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

repo
  .command('find <query>')
  .description('Search for repositories by name or URL')
  .action(async (query: string) => {
    const forge = new ForgeCore(program.opts().config);
    try {
      const results = await forge.repoList(query);
      if (results.length === 0) {
        console.log('No matches found.');
        return;
      }
      for (const r of results) {
        console.log(`${r.name.padEnd(30)} ${r.localPath}`);
      }
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

// forge workspace — workspace management
const workspace = program
  .command('workspace')
  .description('Manage Forge workspaces');

// forge workspace create
workspace
  .command('create')
  .description('Create a new workspace from a workspace config')
  .requiredOption('-c, --config <name>', 'Workspace config artifact ID (e.g., sdlc-default)')
  .option('-v, --config-version <version>', 'Config version constraint (default: *)')
  .option('-n, --name <name>', 'Human-readable workspace name (3-64 chars, alphanumeric and hyphens)')
  .option('-r, --repos <names>', 'Comma-separated list of repo names to include')
  .option('-m, --mount <path>', 'Override mount path')
  .action(async (options: { config: string; configVersion?: string; name?: string; repos?: string; mount?: string }) => {
    const forge = new ForgeCore(program.opts().config);
    try {
      const workspaceRecord = await forge.workspaceCreate({
        configName: options.config,
        configVersion: options.configVersion,
        name: options.name,
        repos: options.repos ? options.repos.split(',').map(r => r.trim()) : undefined,
        mountPath: options.mount,
      });

      console.log(chalk.green(`✓ Created workspace '${workspaceRecord.name}'`));
      console.log(`  ID:   ${workspaceRecord.id}`);
      console.log(`  Path: ${workspaceRecord.path}`);
      if (workspaceRecord.repos.length > 0) {
        console.log(`  Repos: ${workspaceRecord.repos.map(r => r.name).join(', ')}`);
      }
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      if (err.suggestion) console.error(chalk.gray(`  Hint: ${err.suggestion}`));
      process.exit(1);
    }
  });

// forge workspace list
workspace
  .command('list')
  .description('List workspaces')
  .option('--status <status>', 'Filter by status (active|paused|completed|archived)')
  .option('--all', 'Include archived workspaces')
  .action(async (options: { status?: string; all?: boolean }) => {
    const forge = new ForgeCore(program.opts().config);
    try {
      let records = await forge.workspaceList(options.status ? { status: options.status } : undefined);
      
      // Filter out archived unless --all
      if (!options.all) {
        records = records.filter((r: any) => r.status !== 'archived');
      }

      if (records.length === 0) {
        console.log(chalk.yellow('No workspaces found'));
        return;
      }

      const table = new Table({
        head: [
          chalk.bold('ID'),
          chalk.bold('Name'),
          chalk.bold('Status'),
          chalk.bold('Last Accessed'),
          chalk.bold('Path'),
        ],
        colWidths: [12, 30, 12, 20, 50],
      });

      for (const r of records) {
        const lastAccessed = new Date(r.lastAccessedAt).toLocaleDateString();
        table.push([r.id, r.name, r.status, lastAccessed, r.path]);
      }

      console.log(table.toString());
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

// forge workspace status <id>
workspace
  .command('status <id>')
  .description('Show detailed status of a workspace')
  .action(async (id: string) => {
    const forge = new ForgeCore(program.opts().config);
    try {
      const record = await forge.workspaceStatus(id);
      if (!record) {
        console.error(chalk.red(`✗ Workspace '${id}' not found`));
        process.exit(1);
      }

      console.log(chalk.bold(`\nWorkspace: ${record.name}`));
      console.log(`  ID:          ${record.id}`);
      console.log(`  Config:      ${record.configRef}`);
      console.log(`  Status:      ${record.status}`);
      console.log(`  Path:        ${record.path}`);
      console.log(`  Created:     ${new Date(record.createdAt).toLocaleString()}`);
      console.log(`  Last Access: ${new Date(record.lastAccessedAt).toLocaleString()}`);
      if (record.completedAt) {
        console.log(`  Completed:   ${new Date(record.completedAt).toLocaleString()}`);
      }
      console.log(`  Repos:       ${record.repos.length}`);
      for (const repo of record.repos) {
        console.log(`    - ${repo.name} (${repo.localPath})`);
      }
      console.log();
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

// forge workspace delete <id>
workspace
  .command('delete <id>')
  .description('Delete a workspace')
  .option('--force', 'Skip confirmation and ignore uncommitted changes')
  .action(async (id: string, options: { force?: boolean }) => {
    const forge = new ForgeCore(program.opts().config);
    try {
      // Ask for confirmation unless --force
      if (!options.force) {
        const confirmed = await askConfirmation(`Delete workspace '${id}'? This cannot be undone.`);
        if (!confirmed) {
          console.log(chalk.gray('Cancelled'));
          return;
        }
      }

      await forge.workspaceDelete(id, { force: options.force });
      console.log(chalk.green('Workspace deleted.'));
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

// forge workspace pause <id>
workspace
  .command('pause <id>')
  .description('Pause a workspace')
  .action(async (id: string) => {
    const forge = new ForgeCore(program.opts().config);
    try {
      const record = await forge.workspacePause(id);
      console.log(chalk.green(`✓ Paused workspace '${record.name}'`));
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

// forge workspace complete <id>
workspace
  .command('complete <id>')
  .description('Mark a workspace as complete')
  .action(async (id: string) => {
    const forge = new ForgeCore(program.opts().config);
    try {
      const record = await forge.workspaceComplete(id);
      console.log(chalk.green(`✓ Marked workspace '${record.name}' as complete`));
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

// forge workspace clean
workspace
  .command('clean')
  .description('Clean up workspaces based on retention policy')
  .option('--dry-run', 'Show what would be cleaned without actually deleting')
  .option('--force', 'Skip confirmation')
  .action(async (options: { dryRun?: boolean; force?: boolean }) => {
    const forge = new ForgeCore(program.opts().config);
    try {
      const result = await forge.workspaceClean({ dryRun: options.dryRun });

      if (result.cleaned.length === 0) {
        console.log(chalk.yellow('No workspaces to clean'));
        return;
      }

      if (options.dryRun) {
        console.log(chalk.yellow(`Dry run: Would clean ${result.cleaned.length} workspace(s)`));
        for (const id of result.cleaned) {
          console.log(`  - ${id}`);
        }
      } else {
        if (!options.force) {
          const confirmed = await askConfirmation(
            `Clean ${result.cleaned.length} workspace(s) based on retention policy?`,
          );
          if (!confirmed) {
            console.log(chalk.gray('Cancelled'));
            return;
          }
        }

        console.log(chalk.green(`✓ Cleaned ${result.cleaned.length} workspace(s)`));
        if (result.skipped.length > 0) {
          console.log(chalk.yellow(`⚠ ${result.skipped.length} workspace(s) could not be cleaned`));
        }
      }
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

// forge global — global plugin management
const global = program
  .command('global')
  .description('Manage globally installed plugins (~/.claude/)');

// forge global install <ref>
global
  .command('install <ref>')
  .description('Install a plugin globally (e.g., plugin:horus-core)')
  .action(async (ref: string) => {
    const forge = new ForgeCore(program.opts().config);
    try {
      const report = await forge.installGlobal(ref);
      console.log(chalk.green(`✓ Globally installed '${report.pluginId}' v${report.version}`));
      console.log(`  Files written: ${report.filesWritten.length}`);
      for (const f of report.filesWritten) {
        console.log(chalk.gray(`    + ${f}`));
      }
      if (report.claudeMdUpdated) {
        console.log(`  CLAUDE.md: updated with orchestrator rules`);
      }
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      if (err.suggestion) console.error(chalk.gray(`  Hint: ${err.suggestion}`));
      process.exit(1);
    }
  });

// forge global uninstall <plugin-id>
global
  .command('uninstall <plugin-id>')
  .description('Uninstall a globally installed plugin')
  .action(async (pluginId: string) => {
    const forge = new ForgeCore(program.opts().config);
    try {
      await forge.uninstallGlobal(pluginId);
      console.log(chalk.green(`✓ Uninstalled '${pluginId}'`));
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      if (err.suggestion) console.error(chalk.gray(`  Hint: ${err.suggestion}`));
      process.exit(1);
    }
  });

// forge global list
global
  .command('list')
  .description('List globally installed plugins')
  .action(async () => {
    const forge = new ForgeCore(program.opts().config);
    try {
      const plugins = await forge.listGlobal();
      if (plugins.length === 0) {
        console.log(chalk.yellow('No globally installed plugins'));
        return;
      }
      const table = new Table({
        head: [chalk.bold('Plugin'), chalk.bold('Version'), chalk.bold('Installed'), chalk.bold('Files')],
        colWidths: [25, 12, 25, 8],
      });
      for (const p of plugins) {
        table.push([p.id, p.version, new Date(p.installedAt).toLocaleString(), String(p.files.length)]);
      }
      console.log(table.toString());
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

// forge serve — starts MCP server
program
  .command('serve')
  .description('Start the Forge MCP server')
  .option('--transport <mode>', 'Transport mode: stdio or http (default: stdio)', 'stdio')
  .option('--port <port>', 'HTTP port (default: 8200, http transport only)', '8200')
  .option('--host <host>', 'HTTP host (default: localhost, http transport only)', 'localhost')
  .action(async (options: { transport: string; port: string; host: string }) => {
    try {
      // Dynamically import mcp-server to avoid hard dep if not installed
      const mcpServer = await import('@forge/mcp-server');
      const workspaceRoot = program.opts().config;

      if (options.transport === 'http') {
        const port = parseInt(options.port, 10);
        if (isNaN(port) || port < 1 || port > 65535) {
          console.error(chalk.red(`✗ Invalid port: ${options.port}`));
          process.exit(1);
        }
        await mcpServer.startMcpServerHttp({
          port,
          host: options.host,
          workspaceRoot,
        });
      } else {
        await mcpServer.startMcpServer(workspaceRoot);
      }
    } catch (err: any) {
      console.error(chalk.red(`✗ Could not start MCP server: ${err.message}`));
      console.error(chalk.gray(`  Ensure @forge/mcp-server is installed`));
      process.exit(1);
    }
  });

// forge config — global config management
const configCmd = program
  .command('config')
  .description('Manage global Forge configuration (~/.forge/config.yaml)');

// forge config add-registry
configCmd
  .command('add-registry')
  .description('Add a registry to the global config')
  .requiredOption('-n, --name <name>', 'Registry name')
  .requiredOption('-t, --type <type>', 'Registry type (filesystem|git)')
  .option('-u, --url <url>', 'Git clone URL (required for git type)')
  .option('-p, --path <path>', 'Path or registry subdirectory', 'registry')
  .option('-b, --branch <branch>', 'Git branch', 'main')
  .action(async (options: { name: string; type: string; url?: string; path: string; branch: string }) => {
    try {
      let registryConfig: any;
      if (options.type === 'filesystem') {
        registryConfig = { type: 'filesystem', name: options.name, path: options.path };
      } else if (options.type === 'git') {
        if (!options.url) {
          console.error(chalk.red('✗ --url is required for git registries'));
          process.exit(1);
        }
        registryConfig = { type: 'git', name: options.name, url: options.url, branch: options.branch, path: options.path };
      } else {
        console.error(chalk.red(`✗ Unsupported registry type: ${options.type}`));
        process.exit(1);
      }

      const parsed = RegistryConfigSchema.parse(registryConfig);
      const config = await addGlobalRegistry(parsed);
      console.log(chalk.green(`✓ Added registry '${options.name}' to global config`));
      console.log(chalk.gray(`  ${GLOBAL_CONFIG_PATH}`));
      console.log(chalk.gray(`  Total registries: ${config.registries.length}`));
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

// forge config remove-registry <name>
configCmd
  .command('remove-registry <name>')
  .description('Remove a registry from the global config')
  .action(async (name: string) => {
    try {
      const config = await removeGlobalRegistry(name);
      console.log(chalk.green(`✓ Removed registry '${name}' from global config`));
      console.log(chalk.gray(`  Remaining registries: ${config.registries.length}`));
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

// forge config list
configCmd
  .command('list')
  .description('Show the current global config')
  .action(async () => {
    try {
      const config = await loadGlobalConfig();
      if (config.registries.length === 0) {
        console.log(chalk.yellow('No global registries configured'));
        console.log(chalk.gray(`  Config: ${GLOBAL_CONFIG_PATH}`));
        return;
      }
      console.log(chalk.bold('Global registries:'));
      const table = new Table({
        head: [chalk.bold('Name'), chalk.bold('Type'), chalk.bold('Location')],
        colWidths: [20, 12, 50],
      });
      for (const reg of config.registries) {
        const location = reg.type === 'filesystem' ? reg.path
          : reg.type === 'git' ? (reg as any).url
          : (reg as any).url;
        table.push([reg.name, reg.type, location]);
      }
      console.log(table.toString());
      console.log(chalk.gray(`  Config: ${GLOBAL_CONFIG_PATH}`));
    } catch (err: any) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

// Helper function to ask for confirmation
async function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(chalk.yellow(`${question} (y/n) `), (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

program.parse();
