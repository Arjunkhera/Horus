import { describe, it, expect } from 'vitest';
import { RepoIndexQuery } from '../repo-index-query.js';
import type { RepoIndexEntry } from '../../models/repo-index.js';

const mockRepos: RepoIndexEntry[] = [
  {
    name: 'forge',
    localPath: '/home/user/Repositories/forge',
    remoteUrl: 'https://github.com/org/forge.git',
    defaultBranch: 'main',
    language: 'TypeScript',
    framework: null,
    lastCommitDate: '2024-01-01T00:00:00Z',
    lastScannedAt: '2024-01-01T00:00:00Z',
  },
  {
    name: 'react-app',
    localPath: '/home/user/Projects/react-app',
    remoteUrl: 'git@github.com:user/react-app.git',
    defaultBranch: 'develop',
    language: 'JavaScript',
    framework: 'react',
    lastCommitDate: '2024-02-01T00:00:00Z',
    lastScannedAt: '2024-02-01T00:00:00Z',
  },
  {
    name: 'cli-tool',
    localPath: '/home/user/Code/cli-tool',
    remoteUrl: null,
    defaultBranch: 'main',
    language: 'TypeScript',
    framework: null,
    lastCommitDate: '2023-12-01T00:00:00Z',
    lastScannedAt: '2023-12-01T00:00:00Z',
  },
];

describe('RepoIndexQuery', () => {
  describe('findByName', () => {
    it('finds repository by exact name (case-insensitive)', () => {
      const query = new RepoIndexQuery(mockRepos);
      const result = query.findByName('FORGE');
      expect(result).toEqual(mockRepos[0]);
    });

    it('returns null if name not found', () => {
      const query = new RepoIndexQuery(mockRepos);
      const result = query.findByName('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findByRemoteUrl', () => {
    it('matches git@ and https:// forms of same URL', () => {
      const query = new RepoIndexQuery(mockRepos);
      // repo has: git@github.com:user/react-app.git
      // search for: https://github.com/user/react-app
      const result = query.findByRemoteUrl('https://github.com/user/react-app');
      expect(result).toEqual(mockRepos[1]);
    });

    it('returns null if URL not found', () => {
      const query = new RepoIndexQuery(mockRepos);
      const result = query.findByRemoteUrl('https://github.com/other/repo.git');
      expect(result).toBeNull();
    });

    it('handles repos with null remoteUrl', () => {
      const query = new RepoIndexQuery(mockRepos);
      const result = query.findByRemoteUrl('https://github.com/user/cli-tool');
      expect(result).toBeNull();
    });
  });

  describe('search', () => {
    it('fuzzy matches on name', () => {
      const query = new RepoIndexQuery(mockRepos);
      const results = query.search('react');
      expect(results.length).toBe(1);
      expect(results[0]).toEqual(mockRepos[1]);
    });

    it('fuzzy matches on localPath', () => {
      const query = new RepoIndexQuery(mockRepos);
      const results = query.search('Projects');
      expect(results.length).toBe(1);
      expect(results[0]).toEqual(mockRepos[1]);
    });

    it('fuzzy matches on remoteUrl', () => {
      const query = new RepoIndexQuery(mockRepos);
      const results = query.search('github.com/org');
      expect(results.length).toBe(1);
      expect(results[0]).toEqual(mockRepos[0]);
    });

    it('returns results sorted by name', () => {
      const query = new RepoIndexQuery(mockRepos);
      const results = query.search('');
      expect(results[0].name).toBe('cli-tool');
      expect(results[1].name).toBe('forge');
      expect(results[2].name).toBe('react-app');
    });

    it('is case-insensitive', () => {
      const query = new RepoIndexQuery(mockRepos);
      const results = query.search('REACT');
      expect(results.length).toBe(1);
      expect(results[0]).toEqual(mockRepos[1]);
    });
  });

  describe('listAll', () => {
    it('returns all repositories sorted by name', () => {
      const query = new RepoIndexQuery(mockRepos);
      const results = query.listAll();
      expect(results.length).toBe(3);
      expect(results[0].name).toBe('cli-tool');
      expect(results[1].name).toBe('forge');
      expect(results[2].name).toBe('react-app');
    });

    it('does not modify original repos', () => {
      const query = new RepoIndexQuery(mockRepos);
      const results = query.listAll();
      results.pop();
      expect(query.listAll().length).toBe(3);
    });
  });

  describe('getByPath', () => {
    it('finds repository by exact path', () => {
      const query = new RepoIndexQuery(mockRepos);
      const result = query.getByPath('/home/user/Repositories/forge');
      expect(result).toEqual(mockRepos[0]);
    });

    it('returns null if path not found', () => {
      const query = new RepoIndexQuery(mockRepos);
      const result = query.getByPath('/nonexistent/path');
      expect(result).toBeNull();
    });
  });
});
