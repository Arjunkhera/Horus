/**
 * RepoStorageAdapter — CRUD for repo metadata at repos/{org}/{name}/metadata.json.
 *
 * Repos are simpler than artifacts: no versioning, single JSON file per entry.
 * This adapter works directly on a local filesystem directory (the git working tree).
 * It is intentionally decoupled from the versioned StorageBackend interface because
 * the repo layout does not map to {type}/{id}/{version} tuples.
 *
 * Typical usage:
 *   const adapter = new RepoStorageAdapter('/path/to/local/git/workdir');
 *   await adapter.write('acme', 'my-repo', metadata);
 *   const meta = await adapter.read('acme', 'my-repo');
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { RepoMetadataSchema } from '../types/repo-metadata.js';
import type { RepoMetadata } from '../types/repo-metadata.js';

export class RepoStorageAdapter {
  /**
   * @param workDir - Root of the local git working tree (or any directory root).
   *                  Repo files are stored at {workDir}/repos/{org}/{name}/metadata.json.
   */
  constructor(private readonly workDir: string) {}

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Absolute path to a repo's metadata file.
   */
  private metadataPath(org: string, name: string): string {
    return path.join(this.workDir, 'repos', org, name, 'metadata.json');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Write (create or overwrite) repo metadata.
   * Serialises to pretty-printed JSON at repos/{org}/{name}/metadata.json.
   */
  async write(org: string, name: string, metadata: RepoMetadata): Promise<void> {
    const filePath = this.metadataPath(org, name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(metadata, null, 2), 'utf8');
  }

  /**
   * Read repo metadata.
   * Returns null if the file does not exist; throws on parse/other errors.
   */
  async read(org: string, name: string): Promise<RepoMetadata | null> {
    const filePath = this.metadataPath(org, name);
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
    const parsed: unknown = JSON.parse(content);
    return RepoMetadataSchema.parse(parsed);
  }

  /**
   * Delete repo metadata.
   * Returns true if the file existed and was deleted; false if it was not found.
   */
  async delete(org: string, name: string): Promise<boolean> {
    const filePath = this.metadataPath(org, name);
    try {
      await fs.unlink(filePath);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  }

  /**
   * Check whether a repo's metadata file exists.
   */
  async exists(org: string, name: string): Promise<boolean> {
    const filePath = this.metadataPath(org, name);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all registered repos by scanning repos/{org}/{name}/metadata.json files.
   * Repos that fail to parse are skipped with a best-effort approach.
   */
  async listAll(): Promise<RepoMetadata[]> {
    const reposDir = path.join(this.workDir, 'repos');
    const results: RepoMetadata[] = [];

    let orgs: string[];
    try {
      orgs = await fs.readdir(reposDir);
    } catch {
      // repos/ directory doesn't exist yet
      return results;
    }

    for (const org of orgs) {
      const orgDir = path.join(reposDir, org);
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(orgDir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      let names: string[];
      try {
        names = await fs.readdir(orgDir);
      } catch {
        continue;
      }

      for (const name of names) {
        const filePath = path.join(orgDir, name, 'metadata.json');
        try {
          const content = await fs.readFile(filePath, 'utf8');
          const parsed: unknown = JSON.parse(content);
          const metadata = RepoMetadataSchema.parse(parsed);
          results.push(metadata);
        } catch {
          // Skip malformed entries
        }
      }
    }

    return results;
  }
}
