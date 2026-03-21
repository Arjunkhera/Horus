import { promises as fs } from 'fs';
import path from 'path';
import { RepoIndexSchema, type RepoIndex } from '../models/repo-index.js';

/**
 * Save a RepoIndex to disk as JSON.
 * Creates the directory if it doesn't exist.
 */
export async function saveRepoIndex(index: RepoIndex, indexPath: string): Promise<void> {
  const dir = path.dirname(indexPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

/**
 * Load a RepoIndex from disk.
 * Returns null if the file doesn't exist.
 * Returns null and logs a warning if the file is malformed.
 */
export async function loadRepoIndex(indexPath: string): Promise<RepoIndex | null> {
  try {
    const raw = await fs.readFile(indexPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return RepoIndexSchema.parse(parsed);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    console.warn(`[Forge] Warning: Could not parse repo index at ${indexPath}: ${err.message}`);
    return null;
  }
}
