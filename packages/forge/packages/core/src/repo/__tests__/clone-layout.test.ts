import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  horusReposRoot,
  repoClonePath,
  repoWorktreesDir,
  worktreePath,
  ensureHorusIgnored,
} from '../clone-layout.js';

describe('repoClonePath', () => {
  const root = '/data';

  it('is deterministic and host-namespaced', () => {
    expect(repoClonePath('git@github.com:ArjunKhera/Horus.git', root)).toBe(
      '/data/repos/github.com/ArjunKhera/Horus',
    );
  });

  it('separates enterprise hosts to avoid collision', () => {
    const a = repoClonePath('git@github.com:acme/x.git', root);
    const b = repoClonePath('git@github.adobe.com:acme/x.git', root);
    expect(a).not.toBe(b);
  });

  it('is stable across ssh/https forms of the same repo', () => {
    expect(repoClonePath('git@github.com:acme/x.git', root)).toBe(
      repoClonePath('https://github.com/acme/x', root),
    );
  });

  it('roots worktrees inside the clone', () => {
    const clone = repoClonePath('git@github.com:acme/x.git', root);
    expect(repoWorktreesDir(clone)).toBe(`${clone}/.horus/worktrees`);
    expect(worktreePath(clone, 'sess-1')).toBe(`${clone}/.horus/worktrees/sess-1`);
  });

  it('horusReposRoot honors the provided data path', () => {
    expect(horusReposRoot('/x/y')).toBe('/x/y/repos');
  });
});

describe('ensureHorusIgnored', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'ci2-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('adds /.horus/ to .git/info/exclude', async () => {
    await ensureHorusIgnored(dir);
    const exclude = await fs.readFile(join(dir, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toContain('/.horus/');
  });

  it('is idempotent (no duplicate entry on repeat)', async () => {
    await ensureHorusIgnored(dir);
    await ensureHorusIgnored(dir);
    const exclude = await fs.readFile(join(dir, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.match(/\/\.horus\//g)?.length).toBe(1);
  });

  it('keeps git status clean with a populated .horus/ dir', async () => {
    await ensureHorusIgnored(dir);
    await fs.mkdir(join(dir, '.horus', 'worktrees', 'sess-1'), { recursive: true });
    await fs.writeFile(join(dir, '.horus', 'worktrees', 'sess-1', 'f.txt'), 'x');
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString();
    expect(status.trim()).toBe('');
  });

  it('does not mutate a tracked .gitignore', async () => {
    await ensureHorusIgnored(dir);
    await expect(fs.readFile(join(dir, '.gitignore'), 'utf8')).rejects.toThrow();
  });
});
