// Search engine factory and exports

export { QMDAdapter } from './qmd-adapter.js';
export { FtsSearchEngine } from './fts-engine.js';
export type { SearchEngine, SearchResult, SearchOptions } from './engine.js';

/**
 * Create the best available search engine.
 *
 * Priority:
 *   1. QMD HTTP daemon (QMD_DAEMON_URL set) — models warm, no subprocess spawn per request
 *   2. QMD subprocess (qmd binary in PATH) — subprocess per request
 *   3. FTS5 (SQLite full-text search) — no semantic search
 */
import { QMDAdapter } from './qmd-adapter.js';
import { FtsSearchEngine } from './fts-engine.js';
import type { AnvilDb } from '../storage/sqlite.js';
import type { SearchEngine } from './engine.js';

export async function createSearchEngine(
  db: AnvilDb,
  opts?: { qmdCollection?: string; qmdPath?: string }
): Promise<{ engine: SearchEngine; mode: 'qmd' | 'fts' }> {
  const qmdPath = opts?.qmdPath ?? process.env['QMD_PATH'] ?? 'qmd';
  const daemonUrl = process.env['QMD_DAEMON_URL'];

  if (daemonUrl) {
    // HTTP daemon mode: skip subprocess availability probe
    const adapter = new QMDAdapter({
      collectionName: opts?.qmdCollection ?? process.env['ANVIL_QMD_COLLECTION'] ?? 'anvil',
      qmdPath,
      daemonUrl,
    });
    process.stderr.write(JSON.stringify({ level: 'info', message: `Using QMD HTTP daemon at ${daemonUrl}`, timestamp: new Date().toISOString() }) + '\n');
    return { engine: adapter, mode: 'qmd' };
  }

  const isQmdAvailable = await QMDAdapter.isAvailable(qmdPath);

  if (isQmdAvailable) {
    const adapter = new QMDAdapter({
      collectionName: opts?.qmdCollection ?? process.env['ANVIL_QMD_COLLECTION'] ?? 'anvil',
      qmdPath,
    });
    process.stderr.write(JSON.stringify({ level: 'info', message: 'Using QMD subprocess search engine', timestamp: new Date().toISOString() }) + '\n');
    return { engine: adapter, mode: 'qmd' };
  }

  process.stderr.write(JSON.stringify({ level: 'warn', message: 'QMD not available, falling back to FTS5 search', timestamp: new Date().toISOString() }) + '\n');
  return { engine: new FtsSearchEngine(db), mode: 'fts' };
}
