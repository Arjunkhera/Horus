import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { checkbox } from '@inquirer/prompts';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig, type Config } from '../lib/config.js';
import { detectRuntime } from '../lib/runtime.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type ClientTarget = 'claude-desktop' | 'claude-code' | 'cursor';

interface McpServerEntry {
  url: string;
}

interface McpConfig {
  mcpServers: Record<string, McpServerEntry>;
}

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

function mergeAndWriteConfig(configPath: string, mcpServers: Record<string, McpServerEntry>): void {
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

// ── Cursor rules sync ─────────────────────────────────────────────────────────

async function syncSkillsForCursor(runtime: ReturnType<typeof detectRuntime> extends Promise<infer R> ? R : never): Promise<void> {
  const home = homedir();
  const rulesDir = join(home, '.cursor', 'rules');
  const skills = ['horus-anvil', 'horus-vault', 'horus-forge'] as const;
  const forgeContainer = 'horus-forge-1';

  mkdirSync(rulesDir, { recursive: true });

  for (const skill of skills) {
    const src = `/home/forge/.claude/skills/${skill}/SKILL.md`;
    const dest = join(rulesDir, `${skill}.mdc`);
    const result = await runtime.exec(forgeContainer, 'cat', src);
    if (result.exitCode === 0 && result.stdout.trim()) {
      const frontmatter = `---\ndescription: Horus ${skill} reference\nalwaysApply: true\n---\n\n`;
      writeFileSync(dest, frontmatter + result.stdout, 'utf-8');
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
  // Build MCP config
  const mcpServers: Record<string, McpServerEntry> = {
    anvil: { url: `http://${host}:${config.ports.anvil}/sse` },
    vault: { url: `http://${host}:${config.ports.vault_mcp}/sse` },
    forge: { url: `http://${host}:${config.ports.forge}/sse` },
  };

  const configured: ClientTarget[] = [];

  // Write config for each target
  for (const target of targets) {
    const configPath = getConfigPath(target);
    const writeSpinner = ora(`Configuring ${chalk.cyan(target)}...`).start();
    try {
      mergeAndWriteConfig(configPath, mcpServers);
      writeSpinner.succeed(`Configured ${chalk.cyan(target)} — ${chalk.dim(configPath)}`);
      configured.push(target);
    } catch (error) {
      writeSpinner.fail(`Failed to configure ${target}`);
      console.log(chalk.dim((error as Error).message));
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
      cursorRulesSpinner.succeed('horus-core rules synced to ~/.cursor/rules/');
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
