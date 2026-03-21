"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const repo_index_query_js_1 = require("../repo-index-query.js");
const mockRepos = [
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
(0, vitest_1.describe)('RepoIndexQuery', () => {
    (0, vitest_1.describe)('findByName', () => {
        (0, vitest_1.it)('finds repository by exact name (case-insensitive)', () => {
            const query = new repo_index_query_js_1.RepoIndexQuery(mockRepos);
            const result = query.findByName('FORGE');
            (0, vitest_1.expect)(result).toEqual(mockRepos[0]);
        });
        (0, vitest_1.it)('returns null if name not found', () => {
            const query = new repo_index_query_js_1.RepoIndexQuery(mockRepos);
            const result = query.findByName('nonexistent');
            (0, vitest_1.expect)(result).toBeNull();
        });
    });
    (0, vitest_1.describe)('findByRemoteUrl', () => {
        (0, vitest_1.it)('matches git@ and https:// forms of same URL', () => {
            const query = new repo_index_query_js_1.RepoIndexQuery(mockRepos);
            // repo has: git@github.com:user/react-app.git
            // search for: https://github.com/user/react-app
            const result = query.findByRemoteUrl('https://github.com/user/react-app');
            (0, vitest_1.expect)(result).toEqual(mockRepos[1]);
        });
        (0, vitest_1.it)('returns null if URL not found', () => {
            const query = new repo_index_query_js_1.RepoIndexQuery(mockRepos);
            const result = query.findByRemoteUrl('https://github.com/other/repo.git');
            (0, vitest_1.expect)(result).toBeNull();
        });
        (0, vitest_1.it)('handles repos with null remoteUrl', () => {
            const query = new repo_index_query_js_1.RepoIndexQuery(mockRepos);
            const result = query.findByRemoteUrl('https://github.com/user/cli-tool');
            (0, vitest_1.expect)(result).toBeNull();
        });
    });
    (0, vitest_1.describe)('search', () => {
        (0, vitest_1.it)('fuzzy matches on name', () => {
            const query = new repo_index_query_js_1.RepoIndexQuery(mockRepos);
            const results = query.search('react');
            (0, vitest_1.expect)(results.length).toBe(1);
            (0, vitest_1.expect)(results[0]).toEqual(mockRepos[1]);
        });
        (0, vitest_1.it)('fuzzy matches on localPath', () => {
            const query = new repo_index_query_js_1.RepoIndexQuery(mockRepos);
            const results = query.search('Projects');
            (0, vitest_1.expect)(results.length).toBe(1);
            (0, vitest_1.expect)(results[0]).toEqual(mockRepos[1]);
        });
        (0, vitest_1.it)('fuzzy matches on remoteUrl', () => {
            const query = new repo_index_query_js_1.RepoIndexQuery(mockRepos);
            const results = query.search('github.com/org');
            (0, vitest_1.expect)(results.length).toBe(1);
            (0, vitest_1.expect)(results[0]).toEqual(mockRepos[0]);
        });
        (0, vitest_1.it)('returns results sorted by name', () => {
            const query = new repo_index_query_js_1.RepoIndexQuery(mockRepos);
            const results = query.search('');
            (0, vitest_1.expect)(results[0].name).toBe('cli-tool');
            (0, vitest_1.expect)(results[1].name).toBe('forge');
            (0, vitest_1.expect)(results[2].name).toBe('react-app');
        });
        (0, vitest_1.it)('is case-insensitive', () => {
            const query = new repo_index_query_js_1.RepoIndexQuery(mockRepos);
            const results = query.search('REACT');
            (0, vitest_1.expect)(results.length).toBe(1);
            (0, vitest_1.expect)(results[0]).toEqual(mockRepos[1]);
        });
    });
    (0, vitest_1.describe)('listAll', () => {
        (0, vitest_1.it)('returns all repositories sorted by name', () => {
            const query = new repo_index_query_js_1.RepoIndexQuery(mockRepos);
            const results = query.listAll();
            (0, vitest_1.expect)(results.length).toBe(3);
            (0, vitest_1.expect)(results[0].name).toBe('cli-tool');
            (0, vitest_1.expect)(results[1].name).toBe('forge');
            (0, vitest_1.expect)(results[2].name).toBe('react-app');
        });
        (0, vitest_1.it)('does not modify original repos', () => {
            const query = new repo_index_query_js_1.RepoIndexQuery(mockRepos);
            const results = query.listAll();
            results.pop();
            (0, vitest_1.expect)(query.listAll().length).toBe(3);
        });
    });
    (0, vitest_1.describe)('getByPath', () => {
        (0, vitest_1.it)('finds repository by exact path', () => {
            const query = new repo_index_query_js_1.RepoIndexQuery(mockRepos);
            const result = query.getByPath('/home/user/Repositories/forge');
            (0, vitest_1.expect)(result).toEqual(mockRepos[0]);
        });
        (0, vitest_1.it)('returns null if path not found', () => {
            const query = new repo_index_query_js_1.RepoIndexQuery(mockRepos);
            const result = query.getByPath('/nonexistent/path');
            (0, vitest_1.expect)(result).toBeNull();
        });
    });
});
//# sourceMappingURL=repo-index-query.test.js.map