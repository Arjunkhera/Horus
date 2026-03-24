// Search engine factory and exports

export { FtsSearchEngine } from './fts-engine.js';
export { TypesenseSearchEngine } from './typesense-engine.js';
export type { SearchEngine, SearchResult, SearchOptions } from './engine.js';

import { FtsSearchEngine } from './fts-engine.js';
import { TypesenseSearchEngine } from './typesense-engine.js';
import type { TypesenseClient } from '@horus/search';
import type { AnvilDb } from '../storage/sqlite.js';
import type { SearchEngine } from './engine.js';

export async function createSearchEngine(
  db: AnvilDb,
  typesenseClient?: TypesenseClient,
): Promise<{ engine: SearchEngine; mode: 'typesense' | 'fts' }> {
  if (typesenseClient) {
    return { engine: new TypesenseSearchEngine(typesenseClient), mode: 'typesense' };
  }
  return { engine: new FtsSearchEngine(db), mode: 'fts' };
}
