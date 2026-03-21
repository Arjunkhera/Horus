import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { DataAdapter } from './types.js';
import type { ArtifactType, ArtifactBundle, ArtifactMeta } from '../models/index.js';
import { FilesystemAdapter } from './filesystem-adapter.js';
import { AdapterError } from './errors.js';

const execFileAsync = promisify(execFile);

/**
 * Configuration for a GitAdapter.
 *
 * @example
 * const config: GitAdapterConfig = {
 *   url: 'https://github.com/myorg/forge-registry.git',
 *   ref: 'main',
 *   registryPath: 'registry',
 * };
 */
export interface GitAdapterConfig {
  /** Git clone URL (HTTPS or SSH). */
  url: string;
  /** Branch, tag, or commit hash to checkout. Defaults to 'main'. */
  ref?: string;
  /** Subdirectory within the repo that contains the registry layout. Defaults to 'registry'. */
  registryPath?: string;
  /**
   * Directories to sparse-checkout. When set, only these paths are fetched.
   * @example ['skills/developer', 'agents/sdlc-agent']
   */
  sparse?: string[];
  /**
   * Base directory for the git cache.
   * Defaults to `~/.forge/cache/git/`.
   */
  cacheDir?: string;
  /**
   * Environment variable name that holds an HTTPS auth token.
   * When set, the adapter injects the token into the clone URL.
   * SSH keys are used by default when this is not set.
   */
  tokenEnv?: string;
}

/**
 * Git-based DataAdapter. Clones a remote repository and reads it
 * as a filesystem registry using {@link FilesystemAdapter}.
 *
 * On first access the repo is shallow-cloned into a local cache directory.
 * Subsequent accesses run `git fetch` + `git checkout` to update.
 *
 * @example
 * const adapter = new GitAdapter({
 *   url: 'https://github.com/myorg/registry.git',
 *   ref: 'main',
 * });
 * const skills = await adapter.list('skill');
 */
export class GitAdapter implements DataAdapter {
  private readonly url: string;
  private readonly ref: string;
  private readonly registryPath: string;
  private readonly sparse: string[] | undefined;
  private readonly cacheDir: string;
  private readonly tokenEnv: string | undefined;

  private delegate: FilesystemAdapter | null = null;
  private synced = false;

  constructor(config: GitAdapterConfig) {
    this.url = config.url;
    this.ref = config.ref ?? 'main';
    this.registryPath = config.registryPath ?? 'registry';
    this.sparse = config.sparse;
    this.tokenEnv = config.tokenEnv;

    const baseCache = config.cacheDir ?? path.join(os.homedir(), '.forge', 'cache', 'git');
    const repoHash = createHash('sha256').update(this.url).digest('hex').slice(0, 12);
    this.cacheDir = path.join(baseCache, repoHash);
  }

  /**
   * Returns the local cache directory path for this adapter.
   * Useful for debugging and testing.
   */
  getCacheDir(): string {
    return this.cacheDir;
  }

  // ---------------------------------------------------------------------------
  // DataAdapter interface
  // ---------------------------------------------------------------------------

  async list(type: ArtifactType): Promise<ArtifactMeta[]> {
    const delegate = await this.ensureCloned();
    return delegate.list(type);
  }

  async read(type: ArtifactType, id: string): Promise<ArtifactBundle> {
    const delegate = await this.ensureCloned();
    return delegate.read(type, id);
  }

  async exists(type: ArtifactType, id: string): Promise<boolean> {
    const delegate = await this.ensureCloned();
    return delegate.exists(type, id);
  }

  async write(type: ArtifactType, id: string, bundle: ArtifactBundle): Promise<void> {
    const delegate = await this.ensureCloned();
    return delegate.write(type, id, bundle);
  }

  // ---------------------------------------------------------------------------
  // Git operations
  // ---------------------------------------------------------------------------

  /**
   * Ensure the repo is cloned/updated and return the FilesystemAdapter delegate.
   */
  private async ensureCloned(): Promise<FilesystemAdapter> {
    if (this.delegate && this.synced) {
      return this.delegate;
    }

    const exists = await this.cacheExists();

    if (exists) {
      await this.fetchAndCheckout();
    } else {
      await this.cloneRepo();
    }

    const registryRoot = path.join(this.cacheDir, this.registryPath);
    this.delegate = new FilesystemAdapter(registryRoot);
    this.synced = true;
    return this.delegate;
  }

  private async cacheExists(): Promise<boolean> {
    try {
      await fs.access(path.join(this.cacheDir, '.git'));
      return true;
    } catch {
      return false;
    }
  }

  private resolveUrl(): string {
    if (!this.tokenEnv) return this.url;

    const token = process.env[this.tokenEnv];
    if (!token) {
      console.warn(
        `[GitAdapter] Token env var '${this.tokenEnv}' is not set. Falling back to unauthenticated access.`
      );
      return this.url;
    }

    // Inject token into HTTPS URL: https://TOKEN@github.com/...
    try {
      const parsed = new URL(this.url);
      parsed.username = token;
      return parsed.toString();
    } catch {
      // Not a valid URL (might be SSH) — return as-is
      return this.url;
    }
  }

  private async cloneRepo(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });

    const cloneUrl = this.resolveUrl();
    const args = ['clone', '--depth', '1', '--branch', this.ref, '--single-branch'];

    if (this.sparse && this.sparse.length > 0) {
      args.push('--sparse');
    }

    args.push(cloneUrl, this.cacheDir);

    try {
      await this.git(args, path.dirname(this.cacheDir));
    } catch (err: any) {
      throw new AdapterError(
        'GitAdapter',
        `Clone failed for ${this.url}: ${err.message}`,
        `Check that the URL is correct and you have access. If using HTTPS, set the tokenEnv config.`,
      );
    }

    // Configure sparse-checkout paths if specified
    if (this.sparse && this.sparse.length > 0) {
      try {
        await this.git(['sparse-checkout', 'set', ...this.sparse], this.cacheDir);
      } catch (err: any) {
        throw new AdapterError(
          'GitAdapter',
          `Sparse checkout config failed: ${err.message}`,
          `Check that the sparse paths are valid directories in the repository.`,
        );
      }
    }
  }

  private async fetchAndCheckout(): Promise<void> {
    try {
      await this.git(['fetch', '--depth', '1', 'origin', this.ref], this.cacheDir);
      await this.git(['checkout', 'FETCH_HEAD'], this.cacheDir);
    } catch (err: any) {
      throw new AdapterError(
        'GitAdapter',
        `Fetch/checkout failed for ${this.url} ref=${this.ref}: ${err.message}`,
        `Check that the ref '${this.ref}' exists in the repository and that you have network access.`,
      );
    }
  }

  private async git(args: string[], cwd: string): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return stdout;
  }
}
