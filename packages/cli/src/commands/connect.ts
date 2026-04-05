import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { checkbox } from '@inquirer/prompts';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execa } from 'execa';
import { loadConfig, type Config } from '../lib/config.js';
import { detectRuntime } from '../lib/runtime.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type ClientTarget = 'claude-desktop' | 'claude-code' | 'cursor';

interface HttpMcpServerEntry {
  url: string;
}

interface StdioMcpServerEntry {
  command: string;
  args: string[];
}

type McpServerEntry = HttpMcpServerEntry | StdioMcpServerEntry;

// ── Client detection ─────────────────────────────────────────────────────────

export function detectInstalledClients(): ClientTarget[] {
  const detected: ClientTarget[] = [];
  const home = homedir();

  // Claude Desktop (macOS: ~/Library/Application Support/Claude/)
  const claudeDesktopDir = join(home, 'Library', 'Application Support', 'Claude');
  if (existsSync(claudeDesktopDir)) {
    detected.push('claude-desktop');
  }

  // Claude Code (~/.claude/)
  const claudeCodeDir = join(home, '.claude');
  if (existsSync(claudeCodeDir)) {
    detected.push('claude-code');
  }

  // Cursor (~/.cursor/ or ~/Library/Application Support/Cursor/)
  const cursorDir = join(home, '.cursor');
  const cursorAppDir = join(home, 'Library', 'Application Support', 'Cursor');
  if (existsSync(cursorDir) || existsSync(cursorAppDir)) {
    detected.push('cursor');
  }

  return detected;
}

// ── Config file paths ─────────────────────────────────────────────────────────

function getConfigPath(target: ClientTarget): string {
  const home = homedir();
  switch (target) {
    case 'claude-desktop':
      return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    case 'claude-code':
      return join(home, '.claude', 'settings.json');
    case 'cursor':
      return join(home, '.cursor', 'mcp.json');
  }
}

// ── MCP config merging ────────────────────────────────────────────────────────

export function mergeAndWriteConfig(
  configPath: string,
  mcpServers: Record<string, McpServerEntry>,
): void {
  // Read existing config or start fresh
  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // If it's malformed JSON, start fresh
      existing = {};
    }
  }

  // Merge mcpServers key
  const existingServers =
    (existing.mcpServers as Record<string, McpServerEntry> | undefined) ?? {};
  existing.mcpServers = { ...existingServers, ...mcpServers };

  // Ensure parent directory exists
  const dir = configPath.substring(0, configPath.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });

  writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
}

// ── Claude Desktop stdio bridge ──────────────────────────────────────────────

export function getMcpRemoteWrapperPath(): string {
  return join(homedir(), '.forge', 'bin', 'mcp-remote-wrapper');
}

export function buildStdioServers(
  config: Config,
  wrapperPath: string,
  host: string,
): Record<string, StdioMcpServerEntry> {
  return {
    anvil: { command: wrapperPath, args: [`http://${host}:${config.ports.anvil}/mcp`, '--transport', 'http-only'] },
    vault: { command: wrapperPath, args: [`http://${host}:${config.ports.vault_mcp}/mcp`, '--transport', 'http-only'] },
    forge: { command: wrapperPath, args: [`http://${host}:${config.ports.forge}/mcp`, '--transport', 'http-only'] },
  };
}

// ── Claude Code CLI MCP registration ─────────────────────────────────────────

export async function isClaudeCliAvailable(): Promise<boolean> {
  try {
    const result = await execa('claude', ['--version'], { reject: false });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

interface ClaudeCodeRegistrationResult {
  registered: string[];
  failed: string[];
}

export async function registerWithClaudeCode(
  mcpServers: Record<string, HttpMcpServerEntry>,
): Promise<ClaudeCodeRegistrationResult> {
  const registered: string[] = [];
  const failed: string[] = [];

  for (const [name, entry] of Object.entries(mcpServers)) {
    // claude mcp add expects the base URL without the /sse suffix
    const baseUrl = entry.url.replace(/\/sse$/, '');
    // Remove first so re-runs and URL changes are handled cleanly (ignore exit code)
    await execa('claude', ['mcp', 'remove', '--scope', 'user', name], { reject: false });
    const result = await execa(
      'claude',
      ['mcp', 'add', '--transport', 'http', '--scope', 'user', name, baseUrl],
      { reject: false },
    );
    if (result.exitCode === 0) {
      registered.push(name);
    } else {
      failed.push(name);
    }
  }

  return { registered, failed };
}

// ── Skills sync ───────────────────────────────────────────────────────────────

async function syncSkills(runtime: ReturnType<typeof detectRuntime> extends Promise<infer R> ? R : never): Promise<void> {
  const home = homedir();
  const skillsBase = join(home, '.claude', 'skills');
  const skills = ['horus-anvil', 'horus-vault', 'horus-forge'] as const;
  const forgeContainer = 'horus-forge-1';

  for (const skill of skills) {
    const destDir = join(skillsBase, skill);
    mkdirSync(destDir, { recursive: true });
    const src = `/home/forge/.claude/skills/${skill}/SKILL.md`;
    const dest = join(destDir, 'SKILL.md');
    // docker/podman cp <container>:<src> <dest>
    const result = await runtime.exec(forgeContainer, 'cat', src);
    if (result.exitCode === 0 && result.stdout.trim()) {
      writeFileSync(dest, result.stdout, 'utf-8');
    }
  }
}

// ── Cursor rules + skills sync ────────────────────────────────────────────────

async function syncSkillsForCursor(runtime: ReturnType<typeof detectRuntime> extends Promise<infer R> ? R : never): Promise<void> {
  const home = homedir();
  const rulesDir = join(home, '.cursor', 'rules');
  const skillsBase = join(home, '.cursor', 'skills-cursor');
  const skills = ['horus-anvil', 'horus-vault', 'horus-forge'] as const;
  const forgeContainer = 'horus-forge-1';

  mkdirSync(rulesDir, { recursive: true });

  for (const skill of skills) {
    const src = `/home/forge/.claude/skills/${skill}/SKILL.md`;
    const result = await runtime.exec(forgeContainer, 'cat', src);
    if (result.exitCode === 0 && result.stdout.trim()) {
      // Emit as Cursor rule (always-on context)
      const ruleDest = join(rulesDir, `${skill}.mdc`);
      const frontmatter = `---\ndescription: Horus ${skill} reference\nalwaysApply: true\n---\n\n`;
      writeFileSync(ruleDest, frontmatter + result.stdout, 'utf-8');

      // Emit as Cursor skill (on-demand, structured instructions)
      const skillDir = join(skillsBase, skill);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), result.stdout, 'utf-8');
    }
  }
}

// ── Next steps messaging ──────────────────────────────────────────────────────

function printNextSteps(targets: ClientTarget[]): void {
  console.log('');
  console.log(chalk.bold('Next steps:'));
  for (const target of targets) {
    switch (target) {
      case 'claude-desktop':
        console.log(`  ${chalk.cyan('Claude Desktop')}  Restart Claude Desktop to pick up the new MCP configuration`);
        break;
      case 'claude-code':
        console.log(`  ${chalk.cyan('Claude Code')}     Start a new Claude Code session`);
        break;
      case 'cursor':
        console.log(`  ${chalk.cyan('Cursor')}          Restart Cursor to pick up the new MCP configuration and rules`);
        break;
    }
  }
  console.log('');
}

// ── Shared connect logic ─────────────────────────────────────────────────────

type Runtime = Awaited<ReturnType<typeof detectRuntime>>;

export async function runConnect(
  config: Config,
  runtime: Runtime,
  targets: ClientTarget[],
  host: string = 'localhost',
): Promise<ClientTarget[]> {
  // Build HTTP MCP config (used by Claude Code and Cursor)
  const httpServers: Record<string, HttpMcpServerEntry> = {
    anvil: { url: `http://${host}:${config.ports.anvil}/sse` },
    vault: { url: `http://${host}:${config.ports.vault_mcp}/sse` },
    forge: { url: `http://${host}:${config.ports.forge}/sse` },
  };

  const configured: ClientTarget[] = [];

  // Write config for each target
  for (const target of targets) {
    if (target === 'claude-desktop') {
      // Claude Desktop requires stdio-based servers (command + args).
      // It cannot connect to HTTP URLs directly — needs mcp-remote-wrapper as a bridge.
      const desktopSpinner = ora(`Configuring ${chalk.cyan('claude-desktop')}...`).start();
      const wrapperPath = getMcpRemoteWrapperPath();

      if (!existsSync(wrapperPath)) {
        desktopSpinner.fail('mcp-remote-wrapper not found');
        console.log(chalk.dim(`Expected at: ${wrapperPath}`));
        console.log(chalk.dim('Install it with: npx --yes mcp-remote --help'));
        console.log(chalk.dim('Then place the wrapper script at the path above.'));
        continue;
      }

      try {
        const stdioServers = buildStdioServers(config, wrapperPath, host);
        const configPath = getConfigPath(target);
        mergeAndWriteConfig(configPath, stdioServers);
        desktopSpinner.succeed(`Configured ${chalk.cyan('claude-desktop')} — ${chalk.dim(configPath)}`);
        configured.push(target);
      } catch (error) {
        desktopSpinner.fail('Failed to configure claude-desktop');
        console.log(chalk.dim((error as Error).message));
      }
    } else if (target === 'claude-code') {
      // Claude Code CLI reads MCPs from ~/.claude.json via `claude mcp add`,
      // not from ~/.claude/settings.json — so we use the CLI when available.
      const cliSpinner = ora('Registering MCP servers with Claude Code CLI...').start();
      const cliAvailable = await isClaudeCliAvailable();
      if (cliAvailable) {
        const { registered, failed } = await registerWithClaudeCode(httpServers);
        if (failed.length === 0) {
          cliSpinner.succeed(
            `Registered with Claude Code: ${registered.map((n) => chalk.cyan(n)).join(', ')}`,
          );
          configured.push(target);
        } else if (registered.length > 0) {
          cliSpinner.warn(
            `Partially registered — ok: ${registered.join(', ')}, failed: ${failed.join(', ')}`,
          );
          configured.push(target);
        } else {
          cliSpinner.fail('Failed to register MCP servers with Claude Code CLI');
        }
      } else {
        cliSpinner.warn('claude CLI not found on PATH — register manually:');
        for (const [name, entry] of Object.entries(httpServers)) {
          const baseUrl = entry.url.replace(/\/sse$/, '');
          console.log(
            chalk.dim(`  claude mcp add --transport http --scope user ${name} ${baseUrl}`),
          );
        }
      }
    } else {
      // Cursor supports HTTP URLs natively
      const configPath = getConfigPath(target);
      const writeSpinner = ora(`Configuring ${chalk.cyan(target)}...`).start();
      try {
        mergeAndWriteConfig(configPath, httpServers);
        writeSpinner.succeed(`Configured ${chalk.cyan(target)} — ${chalk.dim(configPath)}`);
        configured.push(target);
      } catch (error) {
        writeSpinner.fail(`Failed to configure ${target}`);
        console.log(chalk.dim((error as Error).message));
      }
    }
  }

  // Sync horus-core skills (only when claude-code is a target)
  if (targets.includes('claude-code')) {
    const skillsSpinner = ora('Syncing horus-core skills...').start();
    try {
      await syncSkills(runtime);
      skillsSpinner.succeed('horus-core skills synced to ~/.claude/skills/');
    } catch (error) {
      skillsSpinner.warn('Could not sync skills (Forge container may not be running)');
      console.log(chalk.dim((error as Error).message));
    }
  }

  // Sync horus-core rules for Cursor
  if (targets.includes('cursor')) {
    const cursorRulesSpinner = ora('Syncing horus-core rules for Cursor...').start();
    try {
      await syncSkillsForCursor(runtime);
      cursorRulesSpinner.succeed('horus-core rules synced to ~/.cursor/rules/ and skills to ~/.cursor/skills-cursor/');
    } catch (error) {
      cursorRulesSpinner.warn('Could not sync Cursor rules (Forge container may not be running)');
      console.log(chalk.dim((error as Error).message));
    }
  }

  // Print next steps
  if (configured.length > 0) {
    printNextSteps(configured);
  }

  return configured;
}

// ── Connect command ───────────────────────────────────────────────────────────

export const connectCommand = new Command('connect')
  .description('Configure Claude/Cursor MCP integration')
  .option('--target <client>', 'Client to configure: claude-desktop, claude-code, cursor, all (default: auto-detect)')
  .option('--host <host>', 'MCP host (default: localhost)', 'localhost')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(async (opts) => {
    console.log('');
    console.log(chalk.bold('Horus Connect'));
    console.log(chalk.dim('──────────────────────────────────────'));
    console.log('');

    // Step 1: Load config
    const config = loadConfig();

    // Step 2: Detect runtime (needed for skills sync)
    const runtimeSpinner = ora('Detecting runtime...').start();
    let runtime;
    try {
      runtime = await detectRuntime(config.runtime);
      runtimeSpinner.succeed(`Using ${chalk.cyan(runtime.name)}`);
    } catch (error) {
      runtimeSpinner.fail('No container runtime found');
      console.log((error as Error).message);
      process.exit(1);
    }

    // Step 3: Check Horus is running
    const runningSpinner = ora('Checking Horus status...').start();
    const running = await runtime.isRunning();
    if (!running) {
      runningSpinner.fail('Horus is not running');
      console.log(chalk.dim('Run `horus up` first, then re-run `horus connect`.'));
      process.exit(1);
    }
    runningSpinner.succeed('Horus is running');

    // Step 4: Determine targets
    let targets: ClientTarget[] = [];

    if (opts.target === 'all') {
      targets = ['claude-desktop', 'claude-code', 'cursor'];
    } else if (opts.target) {
      const valid: ClientTarget[] = ['claude-desktop', 'claude-code', 'cursor'];
      if (!valid.includes(opts.target as ClientTarget)) {
        console.log(chalk.red(`Invalid target: ${opts.target}`));
        console.log(chalk.dim('Valid targets: claude-desktop, claude-code, cursor, all'));
        process.exit(1);
      }
      targets = [opts.target as ClientTarget];
    } else {
      // Auto-detect
      const detected = detectInstalledClients();
      if (detected.length === 0) {
        console.log(chalk.yellow('No supported clients detected (Claude Desktop, Claude Code, or Cursor).'));
        console.log(chalk.dim('Use --target to specify a client manually.'));
        process.exit(1);
      }

      if (opts.yes) {
        targets = detected;
        console.log(`Detected clients: ${detected.map((t) => chalk.cyan(t)).join(', ')}`);
      } else {
        const chosen = await checkbox<ClientTarget>({
          message: 'Select clients to configure:',
          choices: detected.map((t) => ({ name: t, value: t, checked: true })),
          validate: (input) =>
            input.length > 0 ? true : 'Select at least one client.',
        });
        targets = chosen;
      }
    }

    if (targets.length === 0) {
      console.log(chalk.yellow('No clients selected. Exiting.'));
      return;
    }

    // Step 5–8: Delegate to shared logic
    await runConnect(config, runtime, targets, opts.host as string);
  });
