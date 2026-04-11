import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GuideEntry, GuideIndex } from '../lib/guide-retrieval.js';

function findGuidesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  const seen = new Set<string>();
  while (dir !== dirname(dir) && !seen.has(dir)) {
    seen.add(dir);
    const candidate = join(dir, 'guides');
    if (existsSync(candidate) && existsSync(join(candidate, 'index.json'))) {
      return candidate;
    }
    dir = dirname(dir);
  }
  throw new Error(
    'Could not find the bundled Horus guides directory. Try reinstalling: npm install -g @arkhera30/cli',
  );
}

function loadIndex(guidesDir: string): GuideIndex {
  return JSON.parse(readFileSync(join(guidesDir, 'index.json'), 'utf8')) as GuideIndex;
}

// ── Topic lookup (pure function — tested independently) ────────────────────
export type LookupTier = 'exact-slug' | 'slug-prefix' | 'title-fuzzy' | 'keyword' | 'none';

export interface LookupResult {
  tier: LookupTier;
  matches: GuideEntry[];
}

/**
 * Resolve a topic string to one or more guides using a fixed precedence:
 *
 *   1. Exact slug match
 *   2. Slug prefix match
 *   3. Title fuzzy match (case-insensitive substring)
 *   4. Keyword exact match (case-insensitive)
 *
 * Returns the first tier that has any hits. Callers should disambiguate if
 * `matches.length > 1`.
 *
 * Pure function — no I/O.
 */
export function lookupTopic(topic: string, index: GuideIndex): LookupResult {
  const t = topic.trim().toLowerCase();
  if (!t) return { tier: 'none', matches: [] };

  const exact = index.guides.filter((g) => g.slug === t);
  if (exact.length > 0) return { tier: 'exact-slug', matches: exact };

  const prefix = index.guides.filter((g) => g.slug.startsWith(t));
  if (prefix.length > 0) return { tier: 'slug-prefix', matches: prefix };

  const titleHits = index.guides.filter((g) => g.title.toLowerCase().includes(t));
  if (titleHits.length > 0) return { tier: 'title-fuzzy', matches: titleHits };

  const kwHits = index.guides.filter((g) =>
    g.keywords.some((k) => k.toLowerCase() === t),
  );
  if (kwHits.length > 0) return { tier: 'keyword', matches: kwHits };

  return { tier: 'none', matches: [] };
}

// ── Output ─────────────────────────────────────────────────────────────────
function printGuideList(index: GuideIndex): void {
  console.log('');
  console.log(chalk.bold('Bundled Horus Guides'));
  console.log(chalk.dim('──────────────────────────────────────'));
  console.log('');
  for (const g of index.guides) {
    console.log(`  ${chalk.cyan(g.slug.padEnd(20))} ${g.title}`);
    console.log(`  ${' '.repeat(20)} ${chalk.dim(g.description)}`);
    console.log('');
  }
  console.log(chalk.dim('Print a guide:            horus guide <slug>'));
  console.log(chalk.dim('Print a guide file path:  horus guide <slug> --path'));
  console.log(chalk.dim('Print the guides root:    horus guide --path'));
  console.log('');
}

function printGuideBody(guidesDir: string, file: string): void {
  const content = readFileSync(join(guidesDir, file), 'utf8');
  console.log(content.replace(/^---\n[\s\S]*?\n---\n?/, ''));
}

function printDisambiguation(tier: LookupTier, matches: GuideEntry[]): void {
  console.log('');
  console.log(chalk.yellow(`Multiple guides matched (tier: ${tier}):`));
  console.log('');
  for (const m of matches) {
    console.log(`  ${chalk.cyan(m.slug.padEnd(20))} ${m.title}`);
  }
  console.log('');
  console.log(chalk.dim('Pick one: horus guide <slug>'));
  console.log('');
}

// ── Command ─────────────────────────────────────────────────────────────────
export const guideCommand = new Command('guide')
  .description('Print a bundled Horus guide, or list all guides')
  .argument('[topic]', 'Slug, slug prefix, or search term. Omit to list all guides.')
  .option('--path', 'Print the file path instead of the body (or the guides dir root if no topic)')
  .action((topic: string | undefined, opts: { path?: boolean }) => {
    const guidesDir = findGuidesDir();
    const index = loadIndex(guidesDir);

    if (!topic) {
      if (opts.path) {
        console.log(guidesDir);
        return;
      }
      printGuideList(index);
      return;
    }

    const result = lookupTopic(topic, index);

    if (result.matches.length === 0) {
      console.log('');
      console.log(chalk.yellow(`No guide matched "${topic}".`));
      console.log('');
      console.log(chalk.dim('Run `horus guide` to see all available guides.'));
      console.log('');
      process.exitCode = 1;
      return;
    }

    if (result.matches.length > 1) {
      printDisambiguation(result.tier, result.matches);
      process.exitCode = 1;
      return;
    }

    const match = result.matches[0];
    if (opts.path) {
      console.log(join(guidesDir, match.file));
      return;
    }
    printGuideBody(guidesDir, match.file);
  });
