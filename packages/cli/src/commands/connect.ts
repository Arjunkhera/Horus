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
  env?: Record<string, string>;
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
  const connectedMode = !!(config.control_plane_url && config.control_plane_url.trim());
  const vaultUrl = connectedMode
    ? `http://${host}:${config.ports.ui}/vault/mcp`
    : `http://${host}:${config.ports.vault_mcp}/mcp`;
  const forgeUrl = connectedMode
    ? `http://${host}:${config.ports.ui}/forge/mcp`
    : `http://${host}:${config.ports.forge}/mcp`;
  return {
    anvil: { command: wrapperPath, args: [`http://${host}:${config.ports.anvil}/mcp`, '--transport', 'http-only'] },
    vault: { command: wrapperPath, args: [vaultUrl, '--transport', 'http-only'] },
    forge: { command: wrapperPath, args: [forgeUrl, '--transport', 'http-only'] },
  };
}

// ── Claude Desktop: mcp-remote bridge ────────────────────────────────────────

export function detectNpxPath(): string {
  const candidates = ['/opt/homebrew/bin/npx', '/usr/local/bin/npx'];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return 'npx';
}

export function buildClaudeDesktopServers(
  config: Config,
  host: string,
): Record<string, StdioMcpServerEntry> {
  const npxPath = detectNpxPath();
  const npxDir = npxPath === 'npx' ? '/usr/local/bin' : npxPath.substring(0, npxPath.lastIndexOf('/'));
  const envPath = `${npxDir}:/usr/local/bin:/usr/bin:/bin`;

  const connectedMode = !!(config.control_plane_url && config.control_plane_url.trim());
  const vaultUrl = connectedMode
    ? `http://${host}:${config.ports.ui}/vault/mcp`
    : `http://${host}:${config.ports.vault_mcp}/mcp`;
  const forgeUrl = connectedMode
    ? `http://${host}:${config.ports.ui}/forge/mcp`
    : `http://${host}:${config.ports.forge}/mcp`;

  return {
    anvil: { command: npxPath, args: ['mcp-remote', `http://${host}:${config.ports.anvil}/mcp`], env: { PATH: envPath } },
    vault: { command: npxPath, args: ['mcp-remote', vaultUrl], env: { PATH: envPath } },
    forge: { command: npxPath, args: ['mcp-remote', forgeUrl], env: { PATH: envPath } },
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
    // claude mcp add expects the base URL without the path suffix
    const baseUrl = entry.url.replace(/\/(mcp|sse)$/, '');
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
  const skills = ['horus-anvil', 'horus-vault', 'horus-forge', 'horus-context', 'capture', 'triage'] as const;
  const forgeContainer = 'horus-forge-1';

  const homeResult = await runtime.exec(forgeContainer, 'sh', '-c', 'echo $HOME');
  const containerHome = homeResult.stdout.trim();

  for (const skill of skills) {
    const destDir = join(skillsBase, skill);
    mkdirSync(destDir, { recursive: true });
    const src = `${containerHome}/.claude/skills/${skill}/SKILL.md`;
    const dest = join(destDir, 'SKILL.md');
    const result = await runtime.exec(forgeContainer, 'cat', src);
    if (result.exitCode === 0 && result.stdout.trim()) {
      writeFileSync(dest, result.stdout, 'utf-8');
    }
  }
}

// ── Registry-based skills sync (connected mode) ──────────────────────────────

const GLOBAL_SKILLS = ['horus-anvil', 'horus-vault', 'horus-forge', 'horus-context', 'capture', 'triage'] as const;
type SkillId = (typeof GLOBAL_SKILLS)[number];

async function fetchLatestSkillBody(controlPlaneUrl: string, id: SkillId): Promise<string | null> {
  const base = controlPlaneUrl.replace(/\/+$/, '');
  // 1. Resolve latest version
  const versionsRes = await fetch(`${base}/api/v1/forge/artifacts/skill/${id}/versions`);
  if (!versionsRes.ok) return null;
  const versionsJson = (await versionsRes.json()) as { versions?: string[] };
  const versions = versionsJson.versions ?? [];
  if (versions.length === 0) return null;
  // Pick highest semver (numeric comparison per segment)
  const latest = versions.slice().sort((a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }).pop()!;
  // 2. Fetch artifact
  const artifactRes = await fetch(`${base}/api/v1/forge/artifacts/skill/${id}/${latest}`);
  if (!artifactRes.ok) return null;
  const artifact = (await artifactRes.json()) as { files?: Record<string, string> };
  const b64 = artifact.files?.['SKILL.md'];
  if (!b64) return null;
  return Buffer.from(b64, 'base64').toString('utf-8');
}

async function syncSkillsFromRegistry(controlPlaneUrl: string): Promise<void> {
  const home = homedir();
  const skillsBase = join(home, '.claude', 'skills');
  let synced = 0;
  const failed: string[] = [];

  for (const id of GLOBAL_SKILLS) {
    try {
      const body = await fetchLatestSkillBody(controlPlaneUrl, id);
      if (!body) {
        failed.push(id);
        continue;
      }
      const destDir = join(skillsBase, id);
      mkdirSync(destDir, { recursive: true });
      writeFileSync(join(destDir, 'SKILL.md'), body, 'utf-8');
      synced++;
    } catch {
      failed.push(id);
    }
  }

  if (failed.length === 0) {
    console.log(chalk.green(`✔ Synced ${synced} global skills from the control plane`));
  } else {
    console.log(chalk.yellow(`✔ Synced ${synced} global skills from the control plane`) +
      chalk.dim(` (failed: ${failed.join(', ')})`));
  }
}

async function syncSkillsForCursorFromRegistry(controlPlaneUrl: string): Promise<void> {
  const home = homedir();
  const rulesDir = join(home, '.cursor', 'rules');
  const skillsBase = join(home, '.cursor', 'skills-cursor');
  mkdirSync(rulesDir, { recursive: true });
  let synced = 0;
  const failed: string[] = [];

  for (const id of GLOBAL_SKILLS) {
    try {
      const body = await fetchLatestSkillBody(controlPlaneUrl, id);
      if (!body) {
        failed.push(id);
        continue;
      }
      // Emit as Cursor rule (always-on context)
      const ruleDest = join(rulesDir, `${id}.mdc`);
      const frontmatter = `---\ndescription: Horus ${id} reference\nalwaysApply: true\n---\n\n`;
      writeFileSync(ruleDest, frontmatter + body, 'utf-8');

      // Emit as Cursor skill (on-demand, structured instructions)
      const skillDir = join(skillsBase, id);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), body, 'utf-8');
      synced++;
    } catch {
      failed.push(id);
    }
  }

  if (failed.length === 0) {
    console.log(chalk.green(`✔ Synced ${synced} global skills for Cursor from the control plane`));
  } else {
    console.log(chalk.yellow(`✔ Synced ${synced} global skills for Cursor from the control plane`) +
      chalk.dim(` (failed: ${failed.join(', ')})`));
  }
}

// ── Cursor rules + skills sync ────────────────────────────────────────────────

async function syncSkillsForCursor(runtime: ReturnType<typeof detectRuntime> extends Promise<infer R> ? R : never): Promise<void> {
  const home = homedir();
  const rulesDir = join(home, '.cursor', 'rules');
  const skillsBase = join(home, '.cursor', 'skills-cursor');
  const skills = ['horus-anvil', 'horus-vault', 'horus-forge', 'horus-context', 'capture', 'triage'] as const;
  const forgeContainer = 'horus-forge-1';

  mkdirSync(rulesDir, { recursive: true });

  const homeResult = await runtime.exec(forgeContainer, 'sh', '-c', 'echo $HOME');
  const containerHome = homeResult.stdout.trim();

  for (const skill of skills) {
    const src = `${containerHome}/.claude/skills/${skill}/SKILL.md`;
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
  const connectedMode = !!(config.control_plane_url && config.control_plane_url.trim());

  // Build HTTP MCP config (used by all clients — Claude Desktop, Claude Code, Cursor).
  // In connected mode:
  //   - anvil  stays local (local container, unchanged)
  //   - vault  routes through horus-ui's connected-mode proxy at /vault/mcp
  //   - forge  routes through horus-ui's in-process Forge at /forge/mcp
  // In local-only mode, all three use their direct local container ports.
  const httpServers: Record<string, HttpMcpServerEntry> = connectedMode
    ? {
        anvil: { url: `http://${host}:${config.ports.anvil}/mcp` },
        vault: { url: `http://${host}:${config.ports.ui}/vault/mcp` },
        forge: { url: `http://${host}:${config.ports.ui}/forge/mcp` },
      }
    : {
        anvil: { url: `http://${host}:${config.ports.anvil}/mcp` },
        vault: { url: `http://${host}:${config.ports.vault_mcp}/mcp` },
        forge: { url: `http://${host}:${config.ports.forge}/mcp` },
      };

  const configured: ClientTarget[] = [];

  // Write config for each target
  for (const target of targets) {
    if (target === 'claude-desktop') {
      // Claude Desktop only supports stdio-based MCP servers — it rejects bare HTTP
      // url entries. We use mcp-remote (via npx) as a stdio-to-HTTP bridge.
      // A PATH override is required to ensure Node >=20 is used rather than any
      // older version (e.g. nvm's default) that Claude Desktop may inherit.
      const desktopSpinner = ora(`Configuring ${chalk.cyan('claude-desktop')}...`).start();
      try {
        const configPath = getConfigPath(target);
        const desktopServers = buildClaudeDesktopServers(config, host);
        mergeAndWriteConfig(configPath, desktopServers);
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
          const baseUrl = entry.url.replace(/\/(mcp|sse)$/, '');
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
    if (connectedMode) {
      const skillsSpinner = ora('Syncing horus-core skills from the control plane...').start();
      try {
        await syncSkillsFromRegistry(config.control_plane_url!);
        skillsSpinner.succeed('horus-core skills synced to ~/.claude/skills/');
      } catch (error) {
        skillsSpinner.warn('Could not sync skills from the control plane');
        console.log(chalk.dim((error as Error).message));
      }
    } else {
      const skillsSpinner = ora('Syncing horus-core skills...').start();
      try {
        await syncSkills(runtime);
        skillsSpinner.succeed('horus-core skills synced to ~/.claude/skills/');
      } catch (error) {
        skillsSpinner.warn('Could not sync skills (Forge container may not be running)');
        console.log(chalk.dim((error as Error).message));
      }
    }
  }

  // Sync horus-core rules for Cursor
  if (targets.includes('cursor')) {
    if (connectedMode) {
      const cursorRulesSpinner = ora('Syncing horus-core rules for Cursor from the control plane...').start();
      try {
        await syncSkillsForCursorFromRegistry(config.control_plane_url!);
        cursorRulesSpinner.succeed('horus-core rules synced to ~/.cursor/rules/ and skills to ~/.cursor/skills-cursor/');
      } catch (error) {
        cursorRulesSpinner.warn('Could not sync Cursor rules from the control plane');
        console.log(chalk.dim((error as Error).message));
      }
    } else {
      const cursorRulesSpinner = ora('Syncing horus-core rules for Cursor...').start();
      try {
        await syncSkillsForCursor(runtime);
        cursorRulesSpinner.succeed('horus-core rules synced to ~/.cursor/rules/ and skills to ~/.cursor/skills-cursor/');
      } catch (error) {
        cursorRulesSpinner.warn('Could not sync Cursor rules (Forge container may not be running)');
        console.log(chalk.dim((error as Error).message));
      }
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
