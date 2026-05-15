/**
 * Git StorageBackend implementation.
 *
 * Layout in the git repo:
 *   {type}s/{id}/{version}/{filename}
 *
 * e.g., skills/developer/1.0.0/metadata.yaml
 *
 * Each publish is a single commit pushed to the configured remote.
 * A simple in-process mutex prevents overlapping pushes (single-instance
 * assumption for solo dev use).
 *
 * Security note: deploy key paths NEVER appear in responses, logs, or audit
 * entries — only the presence/absence of a deploy key is logged.
 */

import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as semver from 'semver';
import type { ArtifactType } from '@forge/core';
import type {
  StorageBackend,
  StoredVersionMeta,
  BundleFiles,
  StoredBundle,
  ArtifactIndexMeta,
  VersionUnverifyOverride,
} from './types.js';
import type { GitStorageConfig } from '../config.js';

const execFile = promisify(_execFile);

const ARTIFACT_TYPES: ArtifactType[] = [
  'skill',
  'agent',
  'plugin',
  'persona',
  'workspace-config',
];

/**
 * Converts an ArtifactType to its plural path segment.
 * e.g., 'skill' → 'skills', 'workspace-config' → 'workspace-configs'
 */
function typeSegment(type: ArtifactType): string {
  return `${type}s`;
}

/**
 * Minimal in-process mutex — prevents concurrent git push operations.
 */
class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }

  get isLocked(): boolean {
    return this.locked;
  }
}

export class GitStorageBackend implements StorageBackend {
  private readonly repoUrl: string;
  private readonly workDir: string;
  private readonly deployKeyPath: string | undefined;
  private readonly mutex = new AsyncMutex();
  private initialised = false;

  constructor(config: GitStorageConfig) {
    this.repoUrl = config.url;
    this.workDir = config.localPath;
    this.deployKeyPath = config.deployKeyPath;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Build the GIT_SSH_COMMAND env value if a deploy key is configured.
   */
  private sshEnv(): NodeJS.ProcessEnv {
    if (!this.deployKeyPath) return {};
    return {
      GIT_SSH_COMMAND: `ssh -i ${this.deployKeyPath} -o StrictHostKeyChecking=no -o IdentitiesOnly=yes`,
    };
  }

  /**
   * Run a git command inside the local working tree.
   * Throws with a sanitised error message (no credentials).
   */
  private async git(args: string[], cwd?: string): Promise<string> {
    const dir = cwd ?? this.workDir;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.sshEnv(),
      // Prevent interactive prompts
      GIT_TERMINAL_PROMPT: '0',
    };

    try {
      const { stdout } = await execFile('git', args, {
        cwd: dir,
        env,
        timeout: 60_000,
      });
      return stdout.trim();
    } catch (err) {
      // Sanitise: strip any URL with credentials from the error message
      const msg = (err as Error).message.replace(/https?:\/\/[^@\s]+@/g, 'https://***@');
      throw new Error(`git ${args[0]} failed: ${msg}`);
    }
  }

  /**
   * Ensure the local clone exists. Clones on first use, pulls on subsequent
   * calls. Safe to call multiple times — only clones if workDir is absent.
   */
  private async ensureRepo(): Promise<void> {
    if (this.initialised) return;

    let needsClone = false;
    try {
      await fs.access(path.join(this.workDir, '.git'));
    } catch {
      needsClone = true;
    }

    if (needsClone) {
      await fs.mkdir(this.workDir, { recursive: true });
      await this.git(['clone', this.repoUrl, '.'], this.workDir);
    } else {
      // Pull latest to avoid diverged state on startup.
      // Tolerate empty repos (no commits yet) where pull would fail.
      try {
        await this.git(['pull', '--ff-only', 'origin', 'HEAD']);
      } catch {
        // Empty repo or no remote HEAD — safe to ignore on startup
      }
    }

    this.initialised = true;
  }

  /**
   * Relative path to a version directory inside the working tree.
   */
  private versionDir(type: ArtifactType, id: string, version: string): string {
    return path.join(this.workDir, typeSegment(type), id, version);
  }

  /**
   * Full path to a specific file inside a version directory.
   */
  private filePath(type: ArtifactType, id: string, version: string, filename: string): string {
    return path.join(this.versionDir(type, id, version), filename);
  }

  // ---------------------------------------------------------------------------
  // StorageBackend interface
  // ---------------------------------------------------------------------------

  async ping(): Promise<boolean> {
    try {
      await this.ensureRepo();
      // Verify working tree is a valid git repo
      await this.git(['rev-parse', '--git-dir']);
      return true;
    } catch (err) {
      throw new Error(
        `Git backend unavailable (url: ${this.repoUrl}): ${(err as Error).message}`,
      );
    }
  }

  async exists(type: ArtifactType, id: string, version: string): Promise<boolean> {
    await this.ensureRepo();
    try {
      await fs.access(this.filePath(type, id, version, 'manifest.yaml'));
      return true;
    } catch {
      return false;
    }
  }

  async getMeta(
    type: ArtifactType,
    id: string,
    version: string,
  ): Promise<StoredVersionMeta | null> {
    await this.ensureRepo();
    const manifestPath = this.filePath(type, id, version, 'manifest.yaml');

    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(manifestPath);
    } catch {
      return null;
    }

    const publishedAt = stat.mtimeMs;

    // Read all files in the version directory and compute checksums
    const vDir = this.versionDir(type, id, version);
    const checksums: Record<string, string> = {};
    try {
      const entries = await fs.readdir(vDir);
      for (const entry of entries) {
        if (entry === 'manifest.yaml') continue;
        const buf = await fs.readFile(path.join(vDir, entry));
        checksums[entry] = crypto.createHash('sha256').update(buf).digest('hex');
      }
    } catch {
      // Best-effort
    }

    return { type, id, version, publishedAt, checksums };
  }

  async writeBundle(
    type: ArtifactType,
    id: string,
    version: string,
    files: BundleFiles,
  ): Promise<void> {
    await this.ensureRepo();

    // Reject concurrent publishes
    if (this.mutex.isLocked) {
      const err = new Error(
        `Concurrent publish rejected for ${type}:${id}@${version} — another publish is in progress`,
      );
      (err as NodeJS.ErrnoException).code = 'ECONFLICT';
      throw err;
    }

    await this.mutex.acquire();
    try {
      // Pull latest before writing to reduce diverged-state risk
      await this.git(['pull', '--ff-only', 'origin', 'HEAD']);

      // Check immutability again under the lock (another process may have pushed)
      if (await this.exists(type, id, version)) {
        throw new Error(`Artifact ${type}:${id}@${version} already exists (immutability violation)`);
      }

      const vDir = this.versionDir(type, id, version);
      await fs.mkdir(vDir, { recursive: true });

      // Write all non-manifest files first
      for (const [filename, content] of files) {
        if (filename === 'manifest.yaml') continue;
        const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
        await fs.writeFile(path.join(vDir, filename), buf);
      }

      // Write manifest last (commit marker)
      const manifestContent = files.get('manifest.yaml');
      if (manifestContent === undefined) {
        throw new Error('BundleFiles must include manifest.yaml');
      }
      const manifestBuf = Buffer.isBuffer(manifestContent)
        ? manifestContent
        : Buffer.from(manifestContent, 'utf8');
      await fs.writeFile(path.join(vDir, 'manifest.yaml'), manifestBuf);

      // Stage all new files
      const relativeVersionDir = path.relative(this.workDir, vDir);
      await this.git(['add', relativeVersionDir]);

      // Commit
      const commitMsg = `publish: ${type}/${id}@${version}`;
      await this.git([
        'commit',
        '-m',
        commitMsg,
        '--author',
        'Forge Registry <forge-registry@localhost>',
      ]);

      // Push — if this fails, roll back the commit
      try {
        await this.git(['push', 'origin', 'HEAD']);
      } catch (pushErr) {
        // Roll back the local commit so state stays clean
        try {
          await this.git(['reset', '--hard', 'HEAD~1']);
        } catch {
          // If reset fails too, log but don't swallow push error
        }
        // Remove the written files so the working tree is clean
        try {
          await fs.rm(vDir, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup
        }
        throw pushErr;
      }
    } finally {
      this.mutex.release();
    }
  }

  async readBundle(type: ArtifactType, id: string, version: string): Promise<StoredBundle> {
    await this.ensureRepo();
    const vDir = this.versionDir(type, id, version);

    let entries: string[];
    try {
      entries = await fs.readdir(vDir);
    } catch {
      throw new Error(`Artifact ${type}:${id}@${version} not found in storage`);
    }

    const bundle: StoredBundle = new Map();
    for (const entry of entries) {
      const buf = await fs.readFile(path.join(vDir, entry));
      bundle.set(entry, buf);
    }
    return bundle;
  }

  async listVersions(type: ArtifactType, id: string): Promise<string[]> {
    await this.ensureRepo();
    const artifactDir = path.join(this.workDir, typeSegment(type), id);

    let entries: string[];
    try {
      entries = await fs.readdir(artifactDir);
    } catch {
      return [];
    }

    const versions = entries.filter((e) => semver.valid(e));
    return versions.sort((a, b) => semver.rcompare(a, b));
  }

  // ---------------------------------------------------------------------------
  // Verification helpers
  // ---------------------------------------------------------------------------

  /**
   * Path to the artifact-id-level verified record inside the working tree.
   * Layout: {workDir}/verified-records/{type}s/{id}.json
   */
  private verifiedRecordPath(type: ArtifactType, id: string): string {
    return path.join(this.workDir, 'verified-records', typeSegment(type), `${id}.json`);
  }

  /**
   * Path to the per-version unverify override file inside the working tree.
   * Layout: {workDir}/verified-overrides/{type}s/{id}/{version}.json
   */
  private overridePath(type: ArtifactType, id: string, version: string): string {
    return path.join(this.workDir, 'verified-overrides', typeSegment(type), id, `${version}.json`);
  }

  async isVerified(type: ArtifactType, id: string): Promise<boolean> {
    await this.ensureRepo();
    try {
      const content = await fs.readFile(this.verifiedRecordPath(type, id), 'utf8');
      const parsed = JSON.parse(content) as { verified?: boolean };
      return parsed.verified === true;
    } catch {
      return false;
    }
  }

  async setVerified(type: ArtifactType, id: string, verified: boolean): Promise<void> {
    await this.ensureRepo();
    const recordPath = this.verifiedRecordPath(type, id);
    await fs.mkdir(path.dirname(recordPath), { recursive: true });
    const payload = JSON.stringify({ verified, verifiedAt: new Date().toISOString() });
    await fs.writeFile(recordPath, payload, 'utf8');

    // Commit the verification record
    await this.mutex.acquire();
    try {
      const rel = path.relative(this.workDir, recordPath);
      await this.git(['add', rel]);
      await this.git([
        'commit', '-m', `verify: ${type}/${id} verified=${String(verified)}`,
        '--author', 'Forge Registry <forge-registry@localhost>',
      ]);
      await this.git(['push', 'origin', 'HEAD']);
    } finally {
      this.mutex.release();
    }
  }

  async isVersionRevoked(type: ArtifactType, id: string, version: string): Promise<boolean> {
    return this.isVersionUnverified(type, id, version);
  }

  async isVersionUnverified(type: ArtifactType, id: string, version: string): Promise<boolean> {
    await this.ensureRepo();
    try {
      await fs.access(this.overridePath(type, id, version));
      return true;
    } catch {
      return false;
    }
  }

  async setVersionUnverified(
    type: ArtifactType,
    id: string,
    version: string,
    revokedBy: string,
    reason?: string,
  ): Promise<void> {
    await this.ensureRepo();
    const overridePath = this.overridePath(type, id, version);
    await fs.mkdir(path.dirname(overridePath), { recursive: true });

    const override: VersionUnverifyOverride = {
      verified: false,
      revokedBy,
      revokedAt: new Date().toISOString(),
      ...(reason !== undefined ? { reason } : {}),
    };
    await fs.writeFile(overridePath, JSON.stringify(override), 'utf8');

    // Commit the override
    await this.mutex.acquire();
    try {
      const rel = path.relative(this.workDir, overridePath);
      await this.git(['add', rel]);
      await this.git([
        'commit', '-m', `unverify: ${type}/${id}@${version}`,
        '--author', 'Forge Registry <forge-registry@localhost>',
      ]);
      await this.git(['push', 'origin', 'HEAD']);
    } finally {
      this.mutex.release();
    }
  }

  async listAll(): Promise<ArtifactIndexMeta[]> {
    const { parse: parseYaml } = await import('yaml');
    await this.ensureRepo();

    const results: ArtifactIndexMeta[] = [];

    for (const type of ARTIFACT_TYPES) {
      const typeDir = path.join(this.workDir, typeSegment(type));

      let artifactIds: string[];
      try {
        artifactIds = await fs.readdir(typeDir);
      } catch {
        continue; // Type directory doesn't exist yet
      }

      for (const artifactId of artifactIds) {
        const versions = await this.listVersions(type, artifactId);

        for (const version of versions) {
          const meta = await this.getMeta(type, artifactId, version);
          if (!meta) continue;

          const entry: ArtifactIndexMeta = {
            type,
            id: artifactId,
            version,
            publishedAt: meta.publishedAt,
          };

          // Best-effort: read metadata.yaml for rich fields
          try {
            const content = await fs.readFile(
              this.filePath(type, artifactId, version, 'metadata.yaml'),
              'utf8',
            );
            const parsed = parseYaml(content) as Record<string, unknown>;
            if (typeof parsed['name'] === 'string') entry.name = parsed['name'];
            if (typeof parsed['description'] === 'string') entry.description = parsed['description'];
            if (Array.isArray(parsed['tags'])) entry.tags = parsed['tags'] as string[];
            if (typeof parsed['verified'] === 'boolean') entry.verified = parsed['verified'];
          } catch {
            // Missing metadata.yaml is fine
          }

          results.push(entry);
        }
      }
    }

    return results;
  }
}
