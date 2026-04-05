// Anvil Core Library - exports all core abstractions
// This is the foundation that MCP server builds on top of

export { NoteStore } from './storage/note-store.js';
export { AnvilDb, AnvilDatabase } from './storage/sqlite.js';
export type { SearchEngine, SearchResult, SearchOptions } from './search/engine.js';
export { ViewEngine } from './views/query-engine.js';
export { TypeRegistry } from './types/registry.js';
export { SyncDaemon } from './sync/daemon.js';

// Re-export sync types for convenience
export * from './sync/git.js';
