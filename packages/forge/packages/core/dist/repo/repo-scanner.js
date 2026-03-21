"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scan = scan;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
async function runGit(args, cwd, timeoutMs = 5000) {
    try {
        const { stdout } = await execFileAsync('git', args, {
            cwd,
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024,
        });
        return stdout.trim();
    }
    catch {
        return '';
    }
}
/**
 * Detect the primary programming language of a repository.
 * Checks for marker files in the following order:
 * 1. tsconfig.json → TypeScript
 * 2. package.json → JavaScript
 * 3. pyproject.toml or setup.py → Python
 * 4. Cargo.toml → Rust
 * 5. go.mod → Go
 * 6. pom.xml or build.gradle → Java
 * Returns null if no recognized marker file is found.
 */
async function detectLanguage(repoPath) {
    // TypeScript
    try {
        await fs_1.promises.access(path_1.default.join(repoPath, 'tsconfig.json'));
        return 'TypeScript';
    }
    catch {
        // Continue to next check
    }
    // JavaScript
    try {
        await fs_1.promises.access(path_1.default.join(repoPath, 'package.json'));
        return 'JavaScript';
    }
    catch {
        // Continue to next check
    }
    // Python
    try {
        await fs_1.promises.access(path_1.default.join(repoPath, 'pyproject.toml'));
        return 'Python';
    }
    catch {
        try {
            await fs_1.promises.access(path_1.default.join(repoPath, 'setup.py'));
            return 'Python';
        }
        catch {
            // Continue to next check
        }
    }
    // Rust
    try {
        await fs_1.promises.access(path_1.default.join(repoPath, 'Cargo.toml'));
        return 'Rust';
    }
    catch {
        // Continue to next check
    }
    // Go
    try {
        await fs_1.promises.access(path_1.default.join(repoPath, 'go.mod'));
        return 'Go';
    }
    catch {
        // Continue to next check
    }
    // Java
    try {
        await fs_1.promises.access(path_1.default.join(repoPath, 'pom.xml'));
        return 'Java';
    }
    catch {
        try {
            await fs_1.promises.access(path_1.default.join(repoPath, 'build.gradle'));
            return 'Java';
        }
        catch {
            // Continue
        }
    }
    return null;
}
/**
 * Detect the framework used in a JavaScript/TypeScript project.
 * Reads package.json and checks dependencies for known frameworks.
 */
async function detectFramework(repoPath) {
    try {
        const packageJsonPath = path_1.default.join(repoPath, 'package.json');
        const content = await fs_1.promises.readFile(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(content);
        const deps = {
            ...packageJson.dependencies,
            ...packageJson.devDependencies,
        };
        if (deps.next)
            return 'next';
        if (deps.express)
            return 'express';
        if (deps.fastify)
            return 'fastify';
        if (deps.react)
            return 'react';
        if (deps.vue)
            return 'vue';
        return null;
    }
    catch {
        return null;
    }
}
/**
 * Read the default branch name for a repository.
 *
 * Resolution order:
 * 1. refs/remotes/origin/HEAD — reflects what the remote considers its default (most reliable)
 * 2. .git/HEAD file — current checkout (fallback; wrong when on a feature branch)
 * 3. git symbolic-ref HEAD — same caveat as above
 */
async function readDefaultBranch(repoPath) {
    // Tier 1: remote's default via origin/HEAD symbolic ref
    try {
        const originHead = path_1.default.join(repoPath, '.git', 'refs', 'remotes', 'origin', 'HEAD');
        const content = await fs_1.promises.readFile(originHead, 'utf-8');
        const match = content.trim().match(/refs\/remotes\/origin\/(.+)$/);
        if (match && match[1]) {
            return match[1];
        }
    }
    catch {
        // origin/HEAD not set — try git command
    }
    // Try git symbolic-ref for origin/HEAD (works even without the file if remote was fetched)
    try {
        const branch = await runGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], repoPath);
        // output is "origin/main" — strip the "origin/" prefix
        if (branch)
            return branch.replace(/^origin\//, '');
    }
    catch {
        // No origin/HEAD configured — fall through to local HEAD
    }
    // Tier 2: current checkout (inaccurate on feature branches, but better than nothing)
    try {
        const headPath = path_1.default.join(repoPath, '.git', 'HEAD');
        const content = await fs_1.promises.readFile(headPath, 'utf-8');
        const match = content.trim().match(/refs\/heads\/(.+)$/);
        if (match && match[1]) {
            return match[1];
        }
    }
    catch {
        // Detached HEAD or error
    }
    return 'main';
}
/**
 * Index metadata for a single repository.
 */
async function indexRepo(repoPath) {
    const name = path_1.default.basename(repoPath);
    const localPath = path_1.default.resolve(repoPath);
    const remoteUrl = await runGit(['config', '--get', 'remote.origin.url'], repoPath);
    const defaultBranch = await readDefaultBranch(repoPath);
    const language = await detectLanguage(repoPath);
    const framework = language === 'JavaScript' || language === 'TypeScript'
        ? await detectFramework(repoPath)
        : null;
    const lastCommitDate = await runGit(['log', '-1', '--format=%aI'], repoPath);
    const lastScannedAt = new Date().toISOString();
    return {
        name,
        localPath,
        remoteUrl: remoteUrl || null,
        defaultBranch,
        language,
        framework,
        lastCommitDate: lastCommitDate || '',
        lastScannedAt,
    };
}
/**
 * Scan a single directory for git repositories at the top level (one level deep).
 * Does NOT recurse into subdirectories.
 */
async function scanDirectory(scanPath) {
    const repos = [];
    try {
        const entries = await fs_1.promises.readdir(scanPath, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            const repoPath = path_1.default.join(scanPath, entry.name);
            const gitPath = path_1.default.join(repoPath, '.git');
            try {
                const gitStat = await fs_1.promises.stat(gitPath);
                if (gitStat.isDirectory()) {
                    const repoEntry = await indexRepo(repoPath);
                    repos.push(repoEntry);
                }
            }
            catch {
                // Not a git repo, skip it
            }
        }
    }
    catch (err) {
        if (err?.code !== 'ENOENT') {
            console.warn(`[Forge] Warning: Could not scan directory ${scanPath}: ${err.message}`);
        }
    }
    return repos;
}
/**
 * Scan multiple paths for git repositories and merge with existing index if provided.
 * Repositories found in the current scan replace those in the existing index.
 * Repositories in the existing index that are in paths NOT covered by the current scan are preserved.
 */
async function scan(scanPaths, existingIndex) {
    const allRepos = [];
    const scannedReposByPath = new Map();
    // Scan all provided paths
    for (const scanPath of scanPaths) {
        const repos = await scanDirectory(scanPath);
        allRepos.push(...repos);
        // Track which repos we found in this scan by their local path
        for (const repo of repos) {
            scannedReposByPath.set(repo.localPath, repo);
        }
    }
    // If we have an existing index, preserve repos from scan paths not in the current scan
    if (existingIndex) {
        const currentScanPathsSet = new Set(scanPaths.map(p => path_1.default.resolve(p)));
        for (const existingRepo of existingIndex.repos) {
            // Check if this repo's scan path is covered in the current scan
            const repoScanPath = scanPaths.find(scanPath => {
                const resolved = path_1.default.resolve(scanPath);
                return existingRepo.localPath.startsWith(resolved + path_1.default.sep) ||
                    existingRepo.localPath === resolved;
            });
            // If it's not in a currently-scanned path, preserve it
            if (!repoScanPath && !scannedReposByPath.has(existingRepo.localPath)) {
                allRepos.push(existingRepo);
            }
        }
    }
    return {
        version: '1',
        scannedAt: new Date().toISOString(),
        scanPaths: scanPaths.map(p => path_1.default.resolve(p)),
        repos: allRepos,
    };
}
//# sourceMappingURL=repo-scanner.js.map