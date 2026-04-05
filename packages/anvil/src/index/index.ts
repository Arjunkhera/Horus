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
export { queryNotes, buildQuerySql } from './query.js';
