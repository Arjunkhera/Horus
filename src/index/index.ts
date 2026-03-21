// Barrel export for the index module
export { AnvilDatabase } from './sqlite.js';
export {
  upsertNote,
  deleteNote,
  fullRebuild,
  getNote,
  getForwardRelationships,
  getReverseRelationships,
  getAllNotePaths,
} from './indexer.js';
export { searchFts, queryNotes, combinedSearch, SearchResult } from './fts.js';
