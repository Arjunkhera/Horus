import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { retrieve, type GuideIndex } from '../lib/guide-retrieval.js';

/**
 * Walk up from the compiled module location until we find a sibling `guides/`
 * directory with an `index.json`. This works both in development
 * (packages/cli/guides/) and when installed via npm
 * (node_modules/@arkhera30/cli/guides/).
 */
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
  const indexPath = join(guidesDir, 'index.json');
  return JSON.parse(readFileSync(indexPath, 'utf8')) as GuideIndex;
}

function stripFrontMatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

function printTopicIndex(index: GuideIndex): void {
  console.log('');
  console.log(chalk.bold('Horus Help — Available Guides'));
  console.log(chalk.dim('──────────────────────────────────────'));
  console.log('');
  for (const g of index.guides) {
    console.log(`  ${chalk.cyan(g.slug.padEnd(20))} ${g.title}`);
    console.log(`  ${' '.repeat(20)} ${chalk.dim(g.description)}`);
    console.log('');
  }
  console.log(chalk.dim('Example queries:'));
  console.log(chalk.dim('  horus help how do I start'));
  console.log(chalk.dim('  horus help what is a forge workspace'));
  console.log(chalk.dim('  horus help create my first anvil note'));
  console.log('');
  console.log(chalk.dim('To print a specific guide directly:'));
  console.log(chalk.dim('  horus guide <slug>'));
  console.log('');
}

function printGuideBody(guidesDir: string, file: string): void {
  const path = join(guidesDir, file);
  const content = readFileSync(path, 'utf8');
  console.log(stripFrontMatter(content));
}

function printSeeAlso(
  alternates: Array<{ slug: string; title: string; file: string }>,
  guidesDir: string,
): void {
  if (alternates.length === 0) return;
  console.log(chalk.dim('──────────────────────────────────────'));
  console.log(chalk.bold('See also:'));
  for (const a of alternates) {
    console.log(`  ${chalk.cyan(a.slug.padEnd(20))} ${a.title}`);
    console.log(`  ${' '.repeat(20)} ${chalk.dim(join(guidesDir, a.file))}`);
  }
  console.log('');
}

function printFooter(): void {
  console.log(
    chalk.dim(
      'Run `horus guide <slug>` to print a specific guide without retrieval, or `horus guide` to list all.',
    ),
  );
  console.log('');
}

export const helpCommand = new Command('help')
  .description('Search and print bundled Horus getting-started guides')
  .argument('[query...]', 'Natural-language query. Omit to see the topic index.')
  .action((query: string[]) => {
    const guidesDir = findGuidesDir();
    const index = loadIndex(guidesDir);

    if (!query || query.length === 0) {
      printTopicIndex(index);
      return;
    }

    const queryStr = query.join(' ');
    const result = retrieve(queryStr, index, 3);

    if (!result.primary) {
      console.log('');
      console.log(chalk.yellow(`No guide matched "${queryStr}".`));
      console.log('');
      console.log(chalk.dim('Try `horus help` with no arguments to see the full topic index,'));
      console.log(chalk.dim('or pick a slug directly with `horus guide <slug>`.'));
      console.log('');
      return;
    }

    console.log('');
    console.log(chalk.dim(`# ${result.primary.title}  (${result.primary.slug})`));
    console.log('');
    printGuideBody(guidesDir, result.primary.file);
    console.log('');
    printSeeAlso(result.alternates, guidesDir);
    printFooter();
  });
