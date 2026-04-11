// packages/cli/test/retrieval.fixture.test.ts
//
// Retrieval-quality gate. Runs the canonical query/expected-top-1 fixture
// through the real BM25 retrieval pipeline against the CI-built index at
// packages/cli/guides/index.json. Fails the build on any regression.
//
// The test auto-runs `node scripts/build-guides.mjs` in beforeAll if the
// index is missing, so `pnpm test` is self-sufficient locally (no need to
// remember to build first).
//
// Story: 5719ce0e. Design ref: 7fff3764.

import { beforeAll, describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { retrieve, type GuideIndex } from '../src/lib/guide-retrieval.js';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(TEST_DIR, '..');
const GUIDES_INDEX = join(PACKAGE_ROOT, 'guides', 'index.json');
const FIXTURE_PATH = join(TEST_DIR, 'fixtures', 'retrieval.json');

interface FixtureEntry {
  query: string;
  expectedTop: string;
  covers?: string;
}

interface Fixture {
  schema_version: number;
  entries: FixtureEntry[];
}

const state: { index?: GuideIndex } = {};
const fixture: Fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

beforeAll(() => {
  if (!existsSync(GUIDES_INDEX)) {
    execSync('node scripts/build-guides.mjs', {
      cwd: PACKAGE_ROOT,
      stdio: 'inherit',
    });
  }
  state.index = JSON.parse(readFileSync(GUIDES_INDEX, 'utf8')) as GuideIndex;
});

describe('retrieval quality fixture', () => {
  it('has at least 10 canonical queries', () => {
    expect(fixture.entries.length).toBeGreaterThanOrEqual(10);
  });

  it('covers all five alpha guide slugs', () => {
    const seen = new Set(fixture.entries.map((e) => e.expectedTop));
    const expected = ['getting-started', 'core-concepts', 'first-workspace', 'first-session', 'first-note'];
    for (const slug of expected) {
      expect(seen.has(slug), `fixture should include at least one query for ${slug}`).toBe(true);
    }
  });

  for (const entry of fixture.entries) {
    it(`"${entry.query}" → ${entry.expectedTop}`, () => {
      expect(state.index, 'index not loaded').toBeDefined();
      const result = retrieve(entry.query, state.index!, 3);
      expect(result.primary, `no retrieval match for "${entry.query}"`).not.toBeNull();
      expect(result.primary!.slug, `wrong top-1 for "${entry.query}"`).toBe(entry.expectedTop);
    });
  }
});
