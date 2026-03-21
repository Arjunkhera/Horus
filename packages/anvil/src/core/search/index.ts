// Search engine factory and exports

export { FtsSearchEngine } from './fts-engine.js';
export type { SearchEngine, SearchResult, SearchOptions } from './engine.js';

import { FtsSearchEngine } from './fts-engine.js';
import type { AnvilDb } from '../storage/sqlite.js';
import type { SearchEngine } from './engine.js';

export async function createSearchEngine(
  db: AnvilDb,
): Promise<{ engine: SearchEngine; mode: 'fts' }> {
  return { engine: new FtsSearchEngine(db), mode: 'fts' };
}
