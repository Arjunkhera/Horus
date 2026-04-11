import { describe, it, expect } from 'vitest';
import { retrieve, tokenizeQuery, topN, type GuideIndex } from './guide-retrieval.js';

function makeIndex(): GuideIndex {
  return {
    schema_version: 1,
    built_at: '2026-04-11T00:00:00Z',
    guide_count: 3,
    guides: [
      {
        slug: 'getting-started',
        title: 'Getting Started with Horus',
        description: 'Install Horus and run first setup',
        tags: ['onboarding'],
        keywords: ['install', 'setup', 'start', 'begin', 'first'],
        related_commands: ['horus setup'],
        file: 'getting-started.md',
        tokens: ['install', 'horus', 'setup', 'start', 'begin', 'first', 'run', 'cli', 'npm', 'prerequisites'],
      },
      {
        slug: 'first-workspace',
        title: 'Your First Forge Workspace',
        description: 'Create your first isolated workspace',
        tags: ['forge'],
        keywords: ['workspace', 'forge', 'create', 'isolate', 'context'],
        related_commands: [],
        file: 'first-workspace.md',
        tokens: ['workspace', 'forge', 'create', 'isolated', 'context', 'mcp', 'first', 'agent'],
      },
      {
        slug: 'first-note',
        title: 'Your First Anvil Note',
        description: 'Create your first Anvil entity',
        tags: ['anvil'],
        keywords: ['note', 'anvil', 'create', 'type', 'project', 'task'],
        related_commands: [],
        file: 'first-note.md',
        tokens: ['note', 'anvil', 'create', 'type', 'project', 'task', 'first', 'entity'],
      },
    ],
  };
}

describe('tokenizeQuery', () => {
  it('lowercases and splits on non-word chars', () => {
    expect(tokenizeQuery('How do I START coding?')).toEqual(['how', 'do', 'start', 'coding']);
  });

  it('drops tokens shorter than 2 chars', () => {
    expect(tokenizeQuery('a big cat')).toEqual(['big', 'cat']);
  });

  it('strips inline code and code fences', () => {
    expect(tokenizeQuery('run `horus setup` now')).toEqual(['run', 'now']);
    expect(tokenizeQuery('before ```\ncode block\n``` after')).toEqual(['before', 'after']);
  });

  it('returns empty array for empty or whitespace input', () => {
    expect(tokenizeQuery('')).toEqual([]);
    expect(tokenizeQuery('   ')).toEqual([]);
  });
});

describe('retrieve', () => {
  it('returns null primary for empty query', () => {
    const result = retrieve('', makeIndex());
    expect(result.primary).toBeNull();
    expect(result.alternates).toEqual([]);
  });

  it('returns null primary when no tokens match any guide', () => {
    const result = retrieve('zzzzzzzzz qqqqqqqqq', makeIndex());
    expect(result.primary).toBeNull();
    expect(result.alternates).toEqual([]);
  });

  it('picks getting-started for install queries', () => {
    const result = retrieve('how do I install horus on my machine', makeIndex());
    expect(result.primary?.slug).toBe('getting-started');
  });

  it('picks first-workspace for workspace queries', () => {
    const result = retrieve('what is a forge workspace', makeIndex());
    expect(result.primary?.slug).toBe('first-workspace');
  });

  it('picks first-note for anvil note queries', () => {
    const result = retrieve('how do I create an anvil note', makeIndex());
    expect(result.primary?.slug).toBe('first-note');
  });

  it('returns up to maxAlternates entries', () => {
    const result = retrieve('first create', makeIndex(), 2);
    expect(result.alternates.length).toBeLessThanOrEqual(2);
  });

  it('does not include the primary in the alternates list', () => {
    const result = retrieve('first', makeIndex());
    if (result.primary) {
      expect(result.alternates.map((a) => a.slug)).not.toContain(result.primary.slug);
    }
  });

  it('is a pure function — same input yields identical output', () => {
    const index = makeIndex();
    const a = retrieve('install horus setup', index);
    const b = retrieve('install horus setup', index);
    expect(a).toEqual(b);
  });

  it('does not mutate the index', () => {
    const index = makeIndex();
    const before = JSON.stringify(index);
    retrieve('install horus', index);
    retrieve('workspace', index);
    retrieve('note', index);
    expect(JSON.stringify(index)).toBe(before);
  });
});

describe('topN', () => {
  it('returns up to N guides ranked by score', () => {
    const top = topN('first create', makeIndex(), 2);
    expect(top.length).toBeLessThanOrEqual(2);
  });

  it('returns empty array for empty query', () => {
    expect(topN('', makeIndex())).toEqual([]);
  });

  it('returns empty array for unmatched query', () => {
    expect(topN('zzzzzzz', makeIndex())).toEqual([]);
  });
});
