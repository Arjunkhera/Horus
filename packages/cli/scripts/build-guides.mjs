#!/usr/bin/env node
// packages/cli/scripts/build-guides.mjs
//
// Build step for bundled Horus CLI guides. Reads /docs/*.md at the monorepo
// root, validates each guide against /docs/.schema/guide-frontmatter.schema.json,
// copies passing guides into packages/cli/guides/, and emits guides/index.json
// — the retrieval index consumed by `horus help` and `horus guide`.
//
// This script runs as part of `pnpm --filter @arkhera30/cli build` and is
// gated by CI. Invalid front-matter fails the build; unknown fields warn.
//
// Design reference: proposal 7fff3764 (Horus Help Agent + Bundled Guides).
// Contract for /docs/.schema/ and index.json shape: /docs/_contributing.md.

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
  existsSync,
  copyFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exit, env } from 'node:process';
import YAML from 'yaml';

// ── Paths ───────────────────────────────────────────────────────────────────
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_DIR = dirname(SCRIPT_DIR);
const MONOREPO_ROOT = dirname(dirname(CLI_DIR));
const DOCS_DIR = join(MONOREPO_ROOT, 'docs');
const SCHEMA_PATH = join(DOCS_DIR, '.schema', 'guide-frontmatter.schema.json');
const OUTPUT_DIR = join(CLI_DIR, 'guides');

// ── Schema validation (hand-rolled against the committed JSON Schema) ───────
function loadSchema() {
  if (!existsSync(SCHEMA_PATH)) {
    fail(`Schema not found at ${SCHEMA_PATH}. Story #1 (dd4cfc70) must ship the schema before this build can run.`);
  }
  try {
    return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  } catch (err) {
    fail(`Failed to parse ${SCHEMA_PATH}: ${err.message}`);
  }
}

function validate(fm, schema) {
  const errors = [];
  const warnings = [];

  if (fm == null || typeof fm !== 'object') {
    return { errors: ['front-matter is not an object'], warnings };
  }

  for (const req of schema.required) {
    if (!(req in fm) || fm[req] == null) {
      errors.push(`missing required field: ${req}`);
    }
  }

  if (typeof fm.title === 'string' && fm.title.length < 1) {
    errors.push('title must not be empty');
  } else if ('title' in fm && typeof fm.title !== 'string') {
    errors.push('title must be a string');
  }

  if (typeof fm.description === 'string') {
    if (fm.description.length < 1) errors.push('description must not be empty');
    if (fm.description.length > 200) errors.push(`description too long (${fm.description.length} > 200)`);
  } else if ('description' in fm) {
    errors.push('description must be a string');
  }

  const slugPattern = new RegExp(schema.properties.slug.pattern);
  if ('slug' in fm && (typeof fm.slug !== 'string' || !slugPattern.test(fm.slug))) {
    errors.push(`slug ${JSON.stringify(fm.slug)} does not match ${schema.properties.slug.pattern}`);
  }

  if ('tags' in fm) {
    if (!Array.isArray(fm.tags) || fm.tags.length < 1) {
      errors.push('tags must be a non-empty array');
    } else {
      const tagPattern = new RegExp(schema.properties.tags.items.pattern);
      for (const t of fm.tags) {
        if (typeof t !== 'string' || !tagPattern.test(t)) {
          errors.push(`invalid tag: ${JSON.stringify(t)}`);
        }
      }
    }
  }

  if ('schema_version' in fm && fm.schema_version !== 1) {
    errors.push(`schema_version must equal 1 (got ${fm.schema_version})`);
  }

  if ('keywords' in fm) {
    if (!Array.isArray(fm.keywords)) {
      errors.push('keywords must be an array');
    } else if (fm.keywords.length === 0) {
      warnings.push('keywords is empty — retrieval quality will suffer');
    }
  }

  if ('related_commands' in fm) {
    if (!Array.isArray(fm.related_commands)) {
      errors.push('related_commands must be an array');
    } else {
      const cmdPattern = new RegExp(schema.properties.related_commands.items.pattern);
      for (const c of fm.related_commands) {
        if (typeof c !== 'string' || !cmdPattern.test(c)) {
          errors.push(`invalid related_command: ${JSON.stringify(c)}`);
        }
      }
    }
  }

  const allowed = new Set(Object.keys(schema.properties));
  for (const k of Object.keys(fm)) {
    if (!allowed.has(k)) {
      warnings.push(`unknown field: ${k}`);
    }
  }

  return { errors, warnings };
}

// ── Tokenizer for BM25 retrieval ────────────────────────────────────────────
// Strips code fences, inline code, and markdown punctuation.
// Keeps duplicates so retrieval can compute term frequency.
// Filters English stop words so rare filler tokens (like "my") don't dominate
// BM25 scoring when they happen to appear in only one guide.
//
// NOTE: this tokenizer MUST stay in sync with the one in
// packages/cli/src/lib/guide-retrieval.ts. Diverging would silently break
// retrieval quality.
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'while',
  'of', 'in', 'on', 'at', 'to', 'from', 'for', 'with', 'by', 'as', 'about',
  'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
  'he', 'she', 'we', 'you', 'your', 'our', 'my', 'me', 'us', 'his', 'her', 'him',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing',
  'will', 'would', 'could', 'should', 'can', 'may', 'might', 'must', 'shall',
  'not', 'no', 'yes', 'so', 'too', 'very', 'just', 'only', 'also',
  'all', 'any', 'some', 'each', 'every', 'more', 'most', 'much', 'many',
  'one', 'two', 'three',
  'here', 'there', 'where', 'how', 'why', 'what', 'who', 'which',
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

// ── Front-matter extraction ─────────────────────────────────────────────────
function parseGuide(filepath) {
  const content = readFileSync(filepath, 'utf8');
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { error: 'no YAML front-matter block' };
  }
  let frontmatter;
  try {
    frontmatter = YAML.parse(match[1]);
  } catch (err) {
    return { error: `YAML parse error: ${err.message}` };
  }
  return { frontmatter, body: match[2] };
}

// ── Output ──────────────────────────────────────────────────────────────────
function fail(msg) {
  console.error(`build-guides: ${msg}`);
  exit(1);
}

function info(msg) {
  console.log(`build-guides: ${msg}`);
}

function warn(file, msg) {
  console.warn(`build-guides: warn: ${file}: ${msg}`);
}

// ── Main ────────────────────────────────────────────────────────────────────
function main() {
  if (!existsSync(DOCS_DIR)) {
    fail(`Docs directory not found at ${DOCS_DIR}`);
  }

  const schema = loadSchema();

  const entries = readdirSync(DOCS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.md') && !d.name.startsWith('_'))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (entries.length === 0) {
    fail(`No guide files found in ${DOCS_DIR} (looked for *.md excluding _*.md)`);
  }

  info(`Found ${entries.length} candidate guide file(s) in /docs/`);

  /** @type {Array<{ file: string; messages: string[] }>} */
  const allErrors = [];
  /** @type {Array<{ slug: string; title: string; description: string; tags: string[]; keywords: string[]; related_commands: string[]; file: string; tokens: string[] }>} */
  const guides = [];
  const slugs = new Set();

  for (const dirent of entries) {
    const filepath = join(DOCS_DIR, dirent.name);
    const parsed = parseGuide(filepath);
    if (parsed.error) {
      allErrors.push({ file: dirent.name, messages: [parsed.error] });
      continue;
    }

    const { frontmatter: fm, body } = parsed;
    const { errors, warnings } = validate(fm, schema);

    for (const w of warnings) warn(dirent.name, w);

    if (errors.length > 0) {
      allErrors.push({ file: dirent.name, messages: errors });
      continue;
    }

    if (slugs.has(fm.slug)) {
      allErrors.push({
        file: dirent.name,
        messages: [`duplicate slug: ${fm.slug} (already used by another guide)`],
      });
      continue;
    }
    slugs.add(fm.slug);

    const keywords = Array.isArray(fm.keywords) ? fm.keywords : [];
    const tokenSource = `${fm.title} ${fm.description} ${keywords.join(' ')} ${body}`;

    guides.push({
      slug: fm.slug,
      title: fm.title,
      description: fm.description,
      tags: fm.tags,
      keywords,
      related_commands: Array.isArray(fm.related_commands) ? fm.related_commands : [],
      file: `${fm.slug}.md`,
      tokens: tokenize(tokenSource),
    });
  }

  if (allErrors.length > 0) {
    console.error('');
    console.error('build-guides: BUILD FAILED');
    for (const e of allErrors) {
      console.error(`  ${e.file}:`);
      for (const m of e.messages) console.error(`    - ${m}`);
    }
    console.error('');
    exit(1);
  }

  // Clean + recreate output dir
  if (existsSync(OUTPUT_DIR)) rmSync(OUTPUT_DIR, { recursive: true, force: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Copy passing guides
  for (const g of guides) {
    const src = join(DOCS_DIR, g.file);
    const dst = join(OUTPUT_DIR, g.file);
    copyFileSync(src, dst);
  }

  // Emit index.json
  const index = {
    schema_version: 1,
    built_at: env.HORUS_BUILD_TIMESTAMP || new Date().toISOString(),
    guide_count: guides.length,
    guides,
  };
  writeFileSync(join(OUTPUT_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n');

  info(`Built ${guides.length} guide(s) → ${OUTPUT_DIR}`);
  info(`  slugs: ${guides.map((g) => g.slug).join(', ')}`);
}

main();
