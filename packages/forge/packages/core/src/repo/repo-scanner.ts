import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { RepoIndexEntry, RepoIndex } from '../models/repo-index.js';

const execFileAsync = promisify(execFile);

async function runGit(args: string[], cwd: string, timeoutMs = 5000): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { 
      cwd, 
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch {
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
async function detectLanguage(repoPath: string): Promise<string | null> {
  // TypeScript
  try {
    await fs.access(path.join(repoPath, 'tsconfig.json'));
    return 'TypeScript';
  } catch {
    // Continue to next check
  }

  // JavaScript
  try {
    await fs.access(path.join(repoPath, 'package.json'));
    return 'JavaScript';
  } catch {
    // Continue to next check
  }

  // Python
  try {
    await fs.access(path.join(repoPath, 'pyproject.toml'));
    return 'Python';
  } catch {
    try {
      await fs.access(path.join(repoPath, 'setup.py'));
      return 'Python';
    } catch {
      // Continue to next check
    }
  }

  // Rust
  try {
    await fs.access(path.join(repoPath, 'Cargo.toml'));
    return 'Rust';
  } catch {
    // Continue to next check
  }

  // Go
  try {
    await fs.access(path.join(repoPath, 'go.mod'));
    return 'Go';
  } catch {
    // Continue to next check
  }

  // Java
  try {
    await fs.access(path.join(repoPath, 'pom.xml'));
    return 'Java';
  } catch {
    try {
      await fs.access(path.join(repoPath, 'build.gradle'));
      return 'Java';
    } catch {
      // Continue
    }
  }

  return null;
}

/**
 * Detect the framework used in a JavaScript/TypeScript project.
 * Reads package.json and checks dependencies for known frameworks.
 */
async function detectFramework(repoPath: string): Promise<string | null> {
  try {
    const packageJsonPath = path.join(repoPath, 'package.json');
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);
    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    if (deps.next) return 'next';
    if (deps.express) return 'express';
    if (deps.fastify) return 'fastify';
    if (deps.react) return 'react';
    if (deps.vue) return 'vue';

    return null;
  } catch {
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
async function readDefaultBranch(repoPath: string): Promise<string> {
  // Tier 1: remote's default via origin/HEAD symbolic ref
  try {
    const originHead = path.join(repoPath, '.git', 'refs', 'remotes', 'origin', 'HEAD');
    const content = await fs.readFile(originHead, 'utf-8');
    const match = content.trim().match(/refs\/remotes\/origin\/(.+)$/);
    if (match && match[1]) {
      return match[1];
    }
  } catch {
    // origin/HEAD not set — try git command
  }

  // Try git symbolic-ref for origin/HEAD (works even without the file if remote was fetched)
  try {
    const branch = await runGit(
      ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
      repoPath,
    );
    // output is "origin/main" — strip the "origin/" prefix
    if (branch) return branch.replace(/^origin\//, '');
  } catch {
    // No origin/HEAD configured — fall through to local HEAD
  }

  // Tier 2: current checkout (inaccurate on feature branches, but better than nothing)
  try {
    const headPath = path.join(repoPath, '.git', 'HEAD');
    const content = await fs.readFile(headPath, 'utf-8');
    const match = content.trim().match(/refs\/heads\/(.+)$/);
    if (match && match[1]) {
      return match[1];
    }
  } catch {
    // Detached HEAD or error
  }

  return 'main';
}

/**
 * Index metadata for a single repository.
 */
async function indexRepo(repoPath: string): Promise<RepoIndexEntry> {
  const name = path.basename(repoPath);
  const localPath = path.resolve(repoPath);

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
async function scanDirectory(scanPath: string): Promise<RepoIndexEntry[]> {
  const repos: RepoIndexEntry[] = [];

  try {
    const entries = await fs.readdir(scanPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const repoPath = path.join(scanPath, entry.name);
      const gitPath = path.join(repoPath, '.git');

      try {
        const gitStat = await fs.stat(gitPath);
        if (gitStat.isDirectory()) {
          const repoEntry = await indexRepo(repoPath);
          repos.push(repoEntry);
        }
      } catch {
        // Not a git repo, skip it
      }
    }
  } catch (err: any) {
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
export async function scan(scanPaths: string[], existingIndex?: RepoIndex): Promise<RepoIndex> {
  const allRepos: RepoIndexEntry[] = [];
  const scannedReposByPath = new Map<string, RepoIndexEntry>();

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
    const currentScanPathsSet = new Set(scanPaths.map(p => path.resolve(p)));
    
    for (const existingRepo of existingIndex.repos) {
      // Check if this repo's scan path is covered in the current scan
      const repoScanPath = scanPaths.find(scanPath => {
        const resolved = path.resolve(scanPath);
        return existingRepo.localPath.startsWith(resolved + path.sep) || 
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
    scanPaths: scanPaths.map(p => path.resolve(p)),
    repos: allRepos,
  };
}
