import { describe, it, expect } from 'vitest';
import { guideCommand, lookupTopic } from './guide.js';
import type { GuideIndex } from '../lib/guide-retrieval.js';

function makeIndex(): GuideIndex {
  return {
    schema_version: 1,
    built_at: '2026-04-11T00:00:00Z',
    guide_count: 4,
    guides: [
      {
        slug: 'getting-started',
        title: 'Getting Started with Horus',
        description: 'Install Horus and run first setup',
        tags: ['onboarding'],
        keywords: ['install', 'begin', 'start'],
        related_commands: ['horus setup'],
        file: 'getting-started.md',
        tokens: [],
      },
      {
        slug: 'first-workspace',
        title: 'Your First Forge Workspace',
        description: 'Create your first isolated workspace',
        tags: ['forge'],
        keywords: ['workspace', 'forge'],
        related_commands: [],
        file: 'first-workspace.md',
        tokens: [],
      },
      {
        slug: 'first-session',
        title: 'Your First Forge Code Session',
        description: 'Start an isolated code session tied to a work item',
        tags: ['forge'],
        keywords: ['session', 'worktree'],
        related_commands: [],
        file: 'first-session.md',
        tokens: [],
      },
      {
        slug: 'first-note',
        title: 'Your First Anvil Note',
        description: 'Create your first Anvil entity',
        tags: ['anvil'],
        keywords: ['note', 'anvil'],
        related_commands: [],
        file: 'first-note.md',
        tokens: [],
      },
    ],
  };
}

describe('guideCommand', () => {
  it('is a commander command named "guide"', () => {
    expect(guideCommand.name()).toBe('guide');
  });

  it('has a description mentioning guides', () => {
    expect(guideCommand.description().toLowerCase()).toContain('guide');
  });

  it('accepts an optional topic argument', () => {
    const args = (guideCommand as unknown as { registeredArguments: Array<{ required: boolean; name(): string }> })
      .registeredArguments;
    expect(args).toBeDefined();
    expect(args.length).toBe(1);
    expect(args[0].name()).toBe('topic');
    expect(args[0].required).toBe(false);
  });

  it('declares --path as an option', () => {
    const pathOpt = guideCommand.options.find((o) => o.long === '--path');
    expect(pathOpt).toBeDefined();
  });
});

describe('lookupTopic', () => {
  it('exact slug match wins over prefix', () => {
    const r = lookupTopic('first-note', makeIndex());
    expect(r.tier).toBe('exact-slug');
    expect(r.matches.map((m) => m.slug)).toEqual(['first-note']);
  });

  it('slug prefix match for ambiguous prefix returns all hits', () => {
    const r = lookupTopic('first', makeIndex());
    expect(r.tier).toBe('slug-prefix');
    expect(r.matches.length).toBe(3);
    expect(r.matches.map((m) => m.slug).sort()).toEqual(['first-note', 'first-session', 'first-workspace']);
  });

  it('title fuzzy match (case-insensitive substring) works', () => {
    const r = lookupTopic('anvil note', makeIndex());
    expect(r.tier).toBe('title-fuzzy');
    expect(r.matches.map((m) => m.slug)).toEqual(['first-note']);
  });

  it('keyword match fires after title fails', () => {
    const r = lookupTopic('install', makeIndex());
    expect(r.tier).toBe('keyword');
    expect(r.matches.map((m) => m.slug)).toEqual(['getting-started']);
  });

  it('empty topic returns tier "none"', () => {
    const r = lookupTopic('', makeIndex());
    expect(r.tier).toBe('none');
    expect(r.matches).toEqual([]);
  });

  it('whitespace-only topic returns tier "none"', () => {
    expect(lookupTopic('   ', makeIndex()).tier).toBe('none');
  });

  it('unknown topic returns tier "none"', () => {
    const r = lookupTopic('zzzzzz', makeIndex());
    expect(r.tier).toBe('none');
    expect(r.matches).toEqual([]);
  });

  it('is case-insensitive', () => {
    const r1 = lookupTopic('FIRST-NOTE', makeIndex());
    const r2 = lookupTopic('first-note', makeIndex());
    expect(r1).toEqual(r2);
  });

  it('is a pure function — same input yields same output', () => {
    const idx = makeIndex();
    const a = lookupTopic('first-note', idx);
    const b = lookupTopic('first-note', idx);
    expect(a).toEqual(b);
  });

  it('does not mutate the index', () => {
    const idx = makeIndex();
    const before = JSON.stringify(idx);
    lookupTopic('first', idx);
    lookupTopic('install', idx);
    lookupTopic('anvil', idx);
    expect(JSON.stringify(idx)).toBe(before);
  });
});
