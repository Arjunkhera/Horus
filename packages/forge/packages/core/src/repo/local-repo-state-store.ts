import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  LocalRepoStateStoreSchema,
  EMPTY_LOCAL_REPO_STATE,
  type LocalRepoStateStore,
  type LocalRepoStateEntry,
  type LocalRepoWorktree,
} from '../models/local-repo-state.js';
import { horusDataPath } from './clone-layout.js';

/** Default store path: {dataPath}/config/repo-state.json (machine-specific). */
export function repoStatePath(dataPath: string = horusDataPath()): string {
  return path.join(dataPath, 'config', 'repo-state.json');
}

/**
 * Persistent, dedup-safe store for LocalRepoState. Mirrors the
 * SessionStoreManager read→transform→write pattern. Entries are keyed by
 * `clonePath` (the deterministic coordinate path), so re-registering the
 * same repo upserts rather than duplicating (D9 dedup requirement).
 */
export class LocalRepoStateStoreManager {
  constructor(private readonly storePath: string = repoStatePath()) {}

  async load(): Promise<LocalRepoStateStore> {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      return LocalRepoStateStoreSchema.parse(JSON.parse(raw));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ...EMPTY_LOCAL_REPO_STATE, repos: [] };
      }
      throw err;
    }
  }

  async save(store: LocalRepoStateStore): Promise<void> {
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await fs.writeFile(this.storePath, JSON.stringify(store, null, 2), 'utf8');
  }

  async get(clonePath: string): Promise<LocalRepoStateEntry | null> {
    const store = await this.load();
    return store.repos.find((r) => r.clonePath === clonePath) ?? null;
  }

  /** Insert or replace the entry for this clonePath (dedup-safe). */
  async upsert(entry: LocalRepoStateEntry): Promise<void> {
    const store = await this.load();
    const idx = store.repos.findIndex((r) => r.clonePath === entry.clonePath);
    if (idx >= 0) store.repos[idx] = entry;
    else store.repos.push(entry);
    await this.save(store);
  }

  /** Patch fields on an existing entry, creating it if absent. */
  async patch(
    seed: Pick<LocalRepoStateEntry, 'host' | 'org' | 'name' | 'clonePath'>,
    patch: Partial<Omit<LocalRepoStateEntry, 'host' | 'org' | 'name' | 'clonePath'>>,
  ): Promise<LocalRepoStateEntry> {
    const store = await this.load();
    let entry = store.repos.find((r) => r.clonePath === seed.clonePath);
    if (!entry) {
      entry = { ...seed, lastFetchedAt: null, lastUsedAt: null, worktrees: [] };
      store.repos.push(entry);
    }
    Object.assign(entry, patch);
    await this.save(store);
    return entry;
  }

  /** Add a worktree record, deduped by sessionId. */
  async addWorktree(clonePath: string, wt: LocalRepoWorktree): Promise<void> {
    const store = await this.load();
    const entry = store.repos.find((r) => r.clonePath === clonePath);
    if (!entry) throw new Error(`LocalRepoState: no entry for ${clonePath}`);
    if (!entry.worktrees.some((w) => w.sessionId === wt.sessionId)) {
      entry.worktrees.push(wt);
    }
    await this.save(store);
  }
}
