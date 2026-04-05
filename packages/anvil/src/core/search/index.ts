// Search engine factory and exports

export { TypesenseSearchEngine } from './typesense-engine.js';
export type { SearchEngine, SearchResult, SearchOptions } from './engine.js';

import { TypesenseSearchEngine } from './typesense-engine.js';
import type { TypesenseClient } from '@horus/search';
import type { SearchEngine } from './engine.js';

export async function createSearchEngine(
  typesenseClient?: TypesenseClient,
): Promise<{ engine: SearchEngine | undefined; mode: 'typesense' | 'none' }> {
  if (typesenseClient) {
    return { engine: new TypesenseSearchEngine(typesenseClient), mode: 'typesense' };
  }
  return { engine: undefined, mode: 'none' };
}
