import { describe, it, expect } from 'vitest';
import { normalizeGitUrl } from '../url-utils.js';

describe('normalizeGitUrl', () => {
  it('converts git@github.com:org/repo.git', () => {
    expect(normalizeGitUrl('git@github.com:org/repo.git')).toBe('github.com/org/repo');
  });

  it('converts https://github.com/org/repo.git', () => {
    expect(normalizeGitUrl('https://github.com/org/repo.git')).toBe('github.com/org/repo');
  });

  it('converts https://github.com/org/repo (no .git)', () => {
    expect(normalizeGitUrl('https://github.com/org/repo')).toBe('github.com/org/repo');
  });

  it('strips auth from https://user:pass@github.com/org/repo.git', () => {
    expect(normalizeGitUrl('https://user:pass@github.com/org/repo.git')).toBe('github.com/org/repo');
  });

  it('converts ssh://git@github.com/org/repo', () => {
    expect(normalizeGitUrl('ssh://git@github.com/org/repo')).toBe('github.com/org/repo');
  });

  it('handles http protocol', () => {
    expect(normalizeGitUrl('http://github.com/org/repo.git')).toBe('github.com/org/repo');
  });

  it('handles git:// protocol', () => {
    expect(normalizeGitUrl('git://github.com/org/repo.git')).toBe('github.com/org/repo');
  });

  it('trims whitespace', () => {
    expect(normalizeGitUrl('  git@github.com:org/repo.git  ')).toBe('github.com/org/repo');
  });
});
