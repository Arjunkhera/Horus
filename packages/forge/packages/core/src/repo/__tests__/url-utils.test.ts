import { describe, it, expect } from 'vitest';
import { normalizeGitUrl, normalizeHost, deriveRepoCoordinate } from '../url-utils.js';

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

describe('normalizeHost', () => {
  it.each([
    ['git@github.com:org/repo.git', 'github.com'],
    ['https://github.com/org/repo', 'github.com'],
    ['git@github.adobe.com:org/repo.git', 'github.adobe.com'],
    ['https://gitlab.example.com/org/repo.git', 'gitlab.example.com'],
    ['https://GitHub.com/Org/Repo', 'github.com'],
    ['https://github.example.com:8443/org/repo.git', 'github.example.com'],
    ['ssh://git@github.com/org/repo', 'github.com'],
  ])('%s → %s', (url, host) => {
    expect(normalizeHost(url)).toBe(host);
  });
});

describe('deriveRepoCoordinate', () => {
  it('derives host/org/name from ssh url', () => {
    expect(deriveRepoCoordinate('git@github.com:ArjunKhera/Horus.git')).toEqual({
      host: 'github.com',
      org: 'ArjunKhera',
      name: 'Horus',
    });
  });

  it('lowercases host and strips port, preserves org/name case', () => {
    expect(deriveRepoCoordinate('https://GitHub.Example.com:8443/Acme/Widget.git')).toEqual({
      host: 'github.example.com',
      org: 'Acme',
      name: 'Widget',
    });
  });

  it('keeps nested GitLab groups in org deterministically', () => {
    expect(deriveRepoCoordinate('https://gitlab.com/group/subgroup/repo.git')).toEqual({
      host: 'gitlab.com',
      org: 'group/subgroup',
      name: 'repo',
    });
  });

  it('distinguishes enterprise hosts (no collision)', () => {
    const a = deriveRepoCoordinate('git@github.com:acme/x.git');
    const b = deriveRepoCoordinate('git@github.adobe.com:acme/x.git');
    expect(a.host).not.toBe(b.host);
  });

  it('throws on a URL without host/org/name', () => {
    expect(() => deriveRepoCoordinate('https://github.com/justhost')).toThrow();
  });
});
