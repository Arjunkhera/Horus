import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, configExists } from '../lib/config.js';
import {
  installArtifactGlobally,
  addManifestRef,
  removeManifestRef,
  listManifestRefs,
  resolveGlobalRefs,
  syncGlobalArtifacts,
  parseRef,
  formatRef,
} from '../lib/global-artifacts.js';

// ── global command ────────────────────────────────────────────────────────────

export const globalCommand = new Command('global')
  .description('Manage globally installed Horus artifacts (~/.claude/skills + ~/.claude/agents)');

/** Resolve the control-plane URL, or exit with guidance if unavailable. */
function requireControlPlaneUrl(): string {
  if (!configExists()) {
    console.log(chalk.red('Horus is not set up yet.'));
    console.log(chalk.dim('Run `horus setup` first.'));
    process.exit(1);
  }
  const config = loadConfig();
  const url = (config.control_plane_url ?? '').trim();
  if (!url) {
    console.log(chalk.red('No control plane configured.'));
    console.log(chalk.dim('Global install pulls artifacts from the control-plane registry. Set control_plane_url via `horus setup` or `horus config`.'));
    process.exit(1);
  }
  return url;
}

// ── global install <ref> ───────────────────────────────────────────────────────

globalCommand
  .command('install <ref>')
  .description('Install an artifact globally and track it for future `horus connect` syncs (e.g. plugin:local-sdlc, workspace-config:finance, skill:horus-anvil, persona:tech-lead)')
  .action(async (ref: string) => {
    console.log('');
    console.log(chalk.bold('Horus Global Install'));
    console.log(chalk.dim('──────────────────────────────────────'));
    console.log('');

    const controlPlaneUrl = requireControlPlaneUrl();
    const canonical = formatRef(parseRef(ref));

    const spinner = ora(`Installing ${chalk.cyan(canonical)}...`).start();
    const result = await installArtifactGlobally(controlPlaneUrl, ref);

    if (result.error || result.emitted.length === 0) {
      spinner.fail(`Could not install ${canonical}`);
      if (result.error) console.log(chalk.dim(result.error));
      process.exit(1);
    }

    spinner.succeed(`Installed ${canonical}`);

    const skills = result.emitted.filter((e) => e.type === 'skill');
    const agents = result.emitted.filter((e) => e.type !== 'skill');
    for (const e of skills) console.log(chalk.dim(`  skill  → ~/.claude/skills/${e.id}/SKILL.md`));
    for (const e of agents) console.log(chalk.dim(`  ${e.type === 'persona' ? 'persona' : 'agent  '}→ ~/.claude/agents/${e.id}.md`));

    const added = addManifestRef(ref);
    console.log('');
    if (added) {
      console.log(chalk.green(`✔ Tracked ${canonical} — it will refresh on every \`horus connect\`.`));
    } else {
      console.log(chalk.dim(`${canonical} was already tracked; refreshed to latest.`));
    }
  });

// ── global list ────────────────────────────────────────────────────────────────

globalCommand
  .command('list')
  .description('List globally tracked artifacts (defaults + your manifest)')
  .action(async () => {
    console.log('');
    console.log(chalk.bold('Globally tracked artifacts'));
    console.log(chalk.dim('──────────────────────────────────────'));

    const manifest = listManifestRefs();
    const all = resolveGlobalRefs();
    const defaults = all.filter((r) => !manifest.some((m) => formatRef(parseRef(m)) === r));

    console.log('');
    console.log(chalk.dim('Built-in defaults:'));
    for (const r of defaults) console.log(`  ${r}`);
    console.log('');
    if (manifest.length === 0) {
      console.log(chalk.dim('Your manifest is empty. Add artifacts with `horus global install <ref>`.'));
    } else {
      console.log(chalk.dim('Your manifest:'));
      for (const r of manifest) console.log(`  ${chalk.cyan(formatRef(parseRef(r)))}`);
    }
    console.log('');
  });

// ── global uninstall <ref> ──────────────────────────────────────────────────────

globalCommand
  .command('uninstall <ref>')
  .alias('remove')
  .description('Stop tracking an artifact (removes it from your manifest; existing files are left in place)')
  .action(async (ref: string) => {
    const canonical = formatRef(parseRef(ref));
    const removed = removeManifestRef(ref);
    if (removed) {
      console.log(chalk.green(`✔ Removed ${canonical} from your global manifest.`));
      console.log(chalk.dim('It will no longer refresh on `horus connect`. Existing files under ~/.claude/ were left untouched.'));
    } else {
      console.log(chalk.yellow(`${canonical} was not in your manifest.`));
      console.log(chalk.dim('(Built-in defaults cannot be removed.)'));
    }
  });

// ── global sync ─────────────────────────────────────────────────────────────────

globalCommand
  .command('sync')
  .description('Re-install all tracked artifacts to their latest versions (same as the sync step in `horus connect`)')
  .action(async () => {
    console.log('');
    console.log(chalk.bold('Horus Global Sync'));
    console.log(chalk.dim('──────────────────────────────────────'));
    console.log('');

    const controlPlaneUrl = requireControlPlaneUrl();
    const refs = resolveGlobalRefs();
    const spinner = ora(`Syncing ${refs.length} tracked artifact(s)...`).start();
    const results = await syncGlobalArtifacts(controlPlaneUrl, refs);

    let skills = 0;
    let agents = 0;
    const failed: string[] = [];
    for (const r of results) {
      if (r.error || r.emitted.length === 0) {
        failed.push(r.ref);
        continue;
      }
      for (const e of r.emitted) {
        if (e.type === 'skill') skills++;
        else agents++;
      }
    }

    const summary = `Synced ${skills} skills` + (agents > 0 ? ` and ${agents} agents` : '');
    if (failed.length === 0) {
      spinner.succeed(summary);
    } else {
      spinner.warn(`${summary} (failed: ${failed.join(', ')})`);
    }
  });
