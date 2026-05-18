/**
 * Tests for RepoStorageAdapter and deepMergeRepo.
 *
 * Uses a real tmpdir (no mocks needed — pure filesystem operations).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { RepoStorageAdapter } from '../src/storage/repo-storage.js';
import { deepMergeRepo } from '../src/utils/deep-merge.js';
import type { RepoMetadata } from '../src/types/repo-metadata.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetadata(overrides: Partial<RepoMetadata> = {}): RepoMetadata {
  return {
    org: 'acme',
    name: 'my-repo',
    canonicalUrl: 'git@github.com:acme/my-repo.git',
    registeredAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// RepoStorageAdapter
// ---------------------------------------------------------------------------

describe('RepoStorageAdapter', () => {
  let tmpDir: string;
  let adapter: RepoStorageAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-storage-test-'));
    adapter = new RepoStorageAdapter(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── write + read roundtrip ───────────────────────────────────────────────

  it('write + read roundtrip preserves all fields', async () => {
    const metadata = makeMetadata({
      description: 'Test repository',
      topics: ['typescript', 'testing'],
      language: 'TypeScript',
      defaultBranch: 'main',
      isPrivate: false,
      isFork: false,
      stars: 42,
      lastPushedAt: '2024-06-01T00:00:00.000Z',
      host: { url: 'https://github.com', provider: 'github' },
      credential: { type: 'gh-cli', label: 'gh' },
      workflow: {
        type: 'owner',
        pushTo: 'origin',
        prTarget: { repo: 'acme/my-repo', branch: 'main' },
        mergeStrategy: 'squash',
      },
      vaultScope: { repo: 'horus', program: 'forge-v3' },
      extra: { custom: true },
    });

    await adapter.write('acme', 'my-repo', metadata);
    const result = await adapter.read('acme', 'my-repo');

    expect(result).not.toBeNull();
    expect(result).toEqual(metadata);
  });

  // ── write to existing overwrites ─────────────────────────────────────────

  it('write to existing org/name overwrites', async () => {
    const first = makeMetadata({ description: 'First version' });
    const second = makeMetadata({ description: 'Second version', updatedAt: '2024-02-01T00:00:00.000Z' });

    await adapter.write('acme', 'my-repo', first);
    await adapter.write('acme', 'my-repo', second);

    const result = await adapter.read('acme', 'my-repo');
    expect(result?.description).toBe('Second version');
    expect(result?.updatedAt).toBe('2024-02-01T00:00:00.000Z');
  });

  // ── read returns null for missing ─────────────────────────────────────────

  it('read returns null for missing repo', async () => {
    const result = await adapter.read('acme', 'nonexistent');
    expect(result).toBeNull();
  });

  // ── delete ────────────────────────────────────────────────────────────────

  it('delete returns true if repo existed', async () => {
    await adapter.write('acme', 'my-repo', makeMetadata());
    const result = await adapter.delete('acme', 'my-repo');
    expect(result).toBe(true);
  });

  it('delete returns false if repo did not exist', async () => {
    const result = await adapter.delete('acme', 'nonexistent');
    expect(result).toBe(false);
  });

  it('delete removes the file so subsequent read returns null', async () => {
    await adapter.write('acme', 'my-repo', makeMetadata());
    await adapter.delete('acme', 'my-repo');
    const result = await adapter.read('acme', 'my-repo');
    expect(result).toBeNull();
  });

  // ── exists ────────────────────────────────────────────────────────────────

  it('exists returns true after write', async () => {
    await adapter.write('acme', 'my-repo', makeMetadata());
    await expect(adapter.exists('acme', 'my-repo')).resolves.toBe(true);
  });

  it('exists returns false for missing repo', async () => {
    await expect(adapter.exists('acme', 'nonexistent')).resolves.toBe(false);
  });

  it('exists returns false after delete', async () => {
    await adapter.write('acme', 'my-repo', makeMetadata());
    await adapter.delete('acme', 'my-repo');
    await expect(adapter.exists('acme', 'my-repo')).resolves.toBe(false);
  });

  // ── listAll ───────────────────────────────────────────────────────────────

  it('listAll returns all registered repos', async () => {
    const repo1 = makeMetadata({ org: 'acme', name: 'repo-1' });
    const repo2 = makeMetadata({ org: 'acme', name: 'repo-2', updatedAt: '2024-02-01T00:00:00.000Z' });
    const repo3 = makeMetadata({
      org: 'other-org',
      name: 'repo-3',
      canonicalUrl: 'git@github.com:other-org/repo-3.git',
      updatedAt: '2024-03-01T00:00:00.000Z',
    });

    await adapter.write('acme', 'repo-1', repo1);
    await adapter.write('acme', 'repo-2', repo2);
    await adapter.write('other-org', 'repo-3', repo3);

    const all = await adapter.listAll();

    expect(all).toHaveLength(3);
    const sorted = all.sort((a, b) => `${a.org}/${a.name}`.localeCompare(`${b.org}/${b.name}`));
    expect(sorted[0]).toEqual(repo1);
    expect(sorted[1]).toEqual(repo2);
    expect(sorted[2]).toEqual(repo3);
  });

  it('listAll returns empty array when no repos exist', async () => {
    const all = await adapter.listAll();
    expect(all).toEqual([]);
  });

  it('listAll does not include deleted repos', async () => {
    await adapter.write('acme', 'repo-1', makeMetadata({ org: 'acme', name: 'repo-1' }));
    await adapter.write('acme', 'repo-2', makeMetadata({ org: 'acme', name: 'repo-2', updatedAt: '2024-02-01T00:00:00.000Z' }));
    await adapter.delete('acme', 'repo-2');

    const all = await adapter.listAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('repo-1');
  });
});

// ---------------------------------------------------------------------------
// deepMergeRepo
// ---------------------------------------------------------------------------

describe('deepMergeRepo', () => {
  const baseMetadata: RepoMetadata = {
    org: 'acme',
    name: 'my-repo',
    canonicalUrl: 'git@github.com:acme/my-repo.git',
    registeredAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    workflow: {
      type: 'owner',
      pushTo: 'origin',
      prTarget: { repo: 'acme/my-repo', branch: 'main' },
      mergeStrategy: 'merge',
    },
    topics: ['typescript', 'backend'],
    description: 'Original description',
  };

  // ── workflow deep merge ───────────────────────────────────────────────────

  it('PATCH { workflow: { mergeStrategy } } preserves existing pushTo and prTarget', () => {
    const result = deepMergeRepo(baseMetadata, {
      workflow: {
        type: 'owner',
        pushTo: 'origin',
        prTarget: { repo: 'acme/my-repo', branch: 'main' },
        mergeStrategy: 'squash',
      },
    });

    expect(result.workflow?.mergeStrategy).toBe('squash');
    expect(result.workflow?.pushTo).toBe('origin');
    expect(result.workflow?.prTarget).toEqual({ repo: 'acme/my-repo', branch: 'main' });
  });

  it('PATCH { workflow: { mergeStrategy } } leaves other fields unchanged', () => {
    const result = deepMergeRepo(baseMetadata, {
      workflow: {
        type: 'owner',
        pushTo: 'origin',
        prTarget: { repo: 'acme/my-repo', branch: 'main' },
        mergeStrategy: 'squash',
      },
    });

    // Original description should be preserved
    expect(result.description).toBe('Original description');
    // topics should be preserved
    expect(result.topics).toEqual(['typescript', 'backend']);
  });

  // ── topics array replacement ──────────────────────────────────────────────

  it('PATCH { topics: ["new"] } replaces the entire array', () => {
    const result = deepMergeRepo(baseMetadata, { topics: ['new-topic'] });
    expect(result.topics).toEqual(['new-topic']);
    // Not merged with existing topics
    expect(result.topics).not.toContain('typescript');
    expect(result.topics).not.toContain('backend');
  });

  it('PATCH { topics: [] } replaces with empty array', () => {
    const result = deepMergeRepo(baseMetadata, { topics: [] });
    expect(result.topics).toEqual([]);
  });

  // ── registeredAt never changes ────────────────────────────────────────────

  it('registeredAt is never changed by merge', () => {
    const result = deepMergeRepo(baseMetadata, {
      registeredAt: '2099-12-31T23:59:59.999Z',
    } as Partial<RepoMetadata>);

    expect(result.registeredAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('registeredAt is preserved even when not in patch', () => {
    const result = deepMergeRepo(baseMetadata, { description: 'New description' });
    expect(result.registeredAt).toBe('2024-01-01T00:00:00.000Z');
  });

  // ── updatedAt is always refreshed ────────────────────────────────────────

  it('updatedAt is always set to a new ISO timestamp', () => {
    const before = Date.now();
    const result = deepMergeRepo(baseMetadata, { description: 'Updated' });
    const after = Date.now();

    const updatedMs = new Date(result.updatedAt).getTime();
    expect(updatedMs).toBeGreaterThanOrEqual(before);
    expect(updatedMs).toBeLessThanOrEqual(after);
    expect(result.updatedAt).not.toBe('2024-01-01T00:00:00.000Z');
  });

  it('updatedAt in patch is ignored (server always sets it)', () => {
    const result = deepMergeRepo(baseMetadata, {
      updatedAt: '2099-01-01T00:00:00.000Z',
    } as Partial<RepoMetadata>);

    // Should NOT be the patch value
    expect(result.updatedAt).not.toBe('2099-01-01T00:00:00.000Z');
    // Should be a real current timestamp
    const updatedMs = new Date(result.updatedAt).getTime();
    expect(updatedMs).toBeGreaterThan(new Date('2024-01-01').getTime());
  });

  // ── scalar field replacement ──────────────────────────────────────────────

  it('scalar fields are replaced', () => {
    const result = deepMergeRepo(baseMetadata, { description: 'New description', language: 'Go' });
    expect(result.description).toBe('New description');
    expect(result.language).toBe('Go');
  });

  // ── deep merge for other nested objects ──────────────────────────────────

  it('PATCH on host deep-merges sub-keys', () => {
    const withHost: RepoMetadata = {
      ...baseMetadata,
      host: { url: 'https://github.com', provider: 'github' },
    };
    const result = deepMergeRepo(withHost, {
      host: { url: 'https://github.enterprise.com', provider: 'github' },
    });

    expect(result.host?.url).toBe('https://github.enterprise.com');
    expect(result.host?.provider).toBe('github');
  });

  it('PATCH on credential deep-merges sub-keys', () => {
    const withCred: RepoMetadata = {
      ...baseMetadata,
      credential: { type: 'gh-cli', label: 'gh' },
    };
    const result = deepMergeRepo(withCred, {
      credential: { type: 'gh-cli', label: 'new-gh', mcpServer: 'github-mcp' },
    });

    expect(result.credential?.label).toBe('new-gh');
    expect(result.credential?.mcpServer).toBe('github-mcp');
    expect(result.credential?.type).toBe('gh-cli');
  });

  // ── returns a new object (immutability) ───────────────────────────────────

  it('does not mutate the existing object', () => {
    const original = { ...baseMetadata };
    deepMergeRepo(baseMetadata, { description: 'Changed', topics: ['new'] });

    expect(baseMetadata.description).toBe(original.description);
    expect(baseMetadata.topics).toEqual(original.topics);
  });
});
