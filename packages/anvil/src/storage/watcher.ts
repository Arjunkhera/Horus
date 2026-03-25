// Chokidar-based file watcher with debounce, batch processing, and startup catchup

import * as path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { AnvilDb } from '../index/sqlite.js';
import type { TypeRegistry } from '../registry/type-registry.js';
import { readNote } from './file-store.js';
import { scanVault } from './file-store.js';
import { upsertNote, deleteNote, getAllNotePaths } from '../index/indexer.js';
import { isAnvilError } from '../types/error.js';
import { DEFAULT_IGNORE_PATTERNS } from '../types/config.js';
import type { TypesenseClient } from '@horus/search';
import { pushToTypesense, deleteFromTypesense } from '../core/search/typesense-doc.js';

/**
 * Watch event type with add, change, or unlink event types
 */
type WatchEvent = {
  type: 'add' | 'change' | 'unlink';
  filePath: string;
};

/**
 * Options for configuring the AnvilWatcher
 */
export type WatcherOptions = {
  vaultPath: string;
  db: AnvilDb;
  registry: TypeRegistry;
  debounceMs?: number;
  ignorePatterns?: string[];
  onError?: (err: Error) => void;
  typesenseClient?: TypesenseClient;
};

/**
 * Chokidar-based file watcher for vault changes.
 * Handles startup catchup to index changes that occurred while offline,
 * debounces events, processes in batches, and watches type definitions.
 */
export class AnvilWatcher {
  private watcher: FSWatcher | null = null;
  private pendingEvents = new Map<string, WatchEvent['type']>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private batchCompletionCallbacks: Array<() => void> = [];

  /**
   * Create a new AnvilWatcher instance
   */
  constructor(private options: WatcherOptions) {}

  /**
   * Start watching the vault.
   * Runs startup catchup first to handle changes while offline,
   * then initializes the chokidar watcher for real-time updates.
   */
  async start(): Promise<void> {
    // Run startup catchup first
    await this.startupCatchup();

    // Initialize chokidar watcher
    this.watcher = chokidar.watch(this.options.vaultPath, {
      ignored: this.buildIgnorePatterns(),
      persistent: true,
      ignoreInitial: true, // we already did catchup
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    this.watcher.on('add', (filePath: string) => this.handleEvent('add', filePath));
    this.watcher.on('change', (filePath: string) => this.handleEvent('change', filePath));
    this.watcher.on('unlink', (filePath: string) => this.handleEvent('unlink', filePath));

    if (this.options.onError) {
      this.watcher.on('error', (err: unknown) => this.options.onError?.(err instanceof Error ? err : new Error(String(err))));
    }

    // Also watch .anvil/types/*.yaml for type definition changes
    this.watchTypeDefinitions();
  }

  /**
   * Stop watching the vault and clean up resources
   */
  async stop(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    await this.watcher?.close();
    this.watcher = null;
  }

  /**
   * Wait for current batch of pending events to be processed.
   * Used by git sync to wait for re-indexing before syncing.
   */
  waitForBatch(): Promise<void> {
    return new Promise((resolve) => {
      if (this.pendingEvents.size === 0 && !this.debounceTimer) {
        resolve();
      } else {
        this.batchCompletionCallbacks.push(resolve);
      }
    });
  }

  /**
   * Handle a file system event by collecting it in the pending events map.
   * Last event for a path wins within the debounce window.
   */
  private handleEvent(eventType: WatchEvent['type'], filePath: string): void {
    // Only watch .md files
    if (!filePath.endsWith('.md')) return;

    // Collect event (last event for a path wins within debounce window)
    this.pendingEvents.set(filePath, eventType);

    // Reset debounce timer
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(
      () => this.processBatch(),
      this.options.debounceMs ?? 500
    );
  }

  /**
   * Process accumulated events in a batch.
   * Deletes are handled by looking up noteId in the database,
   * adds/changes are re-read from disk and re-indexed.
   * Never crashes on a single bad file — logs error and continues.
   */
  private async processBatch(): Promise<void> {
    this.debounceTimer = null;
    const events = new Map(this.pendingEvents);
    this.pendingEvents.clear();

    // Process all events
    for (const [filePath, eventType] of events) {
      try {
        if (eventType === 'unlink') {
          // Find note in DB by filePath and delete
          const row = this.options.db.getOne<{ note_id: string }>(
            'SELECT note_id FROM notes WHERE file_path = ?',
            [filePath]
          );
          if (row) {
            deleteNote(this.options.db, row.note_id);
            if (this.options.typesenseClient) {
              void deleteFromTypesense(this.options.typesenseClient, row.note_id);
            }
          }
        } else {
          // add or change — re-read and re-index
          const result = await readNote(filePath);
          if (!isAnvilError(result)) {
            upsertNote(this.options.db, result.note);
            if (this.options.typesenseClient) {
              void pushToTypesense(this.options.typesenseClient, result.note);
            }
          } else {
            // Log error but continue processing other files
            console.error(`[watcher] Failed to index ${filePath}:`, result.message);
          }
        }
      } catch (err) {
        this.options.onError?.(err as Error);
      }
    }

    // Notify waiting batch completion callbacks
    const callbacks = this.batchCompletionCallbacks.splice(0);
    callbacks.forEach((cb) => cb());
  }

  /**
   * On startup, compare file mtimes to index and re-index changed files.
   * Handles new files, modified files, and deleted files.
   */
  private async startupCatchup(): Promise<void> {
    const indexedPaths = new Map(
      getAllNotePaths(this.options.db).map((row) => [row.filePath, row.modified])
    );

    const toReindex: string[] = [];
    const currentPaths = new Set<string>();

    // Walk filesystem
    for await (const file of scanVault(
      this.options.vaultPath,
      this.buildIgnorePatternsArray()
    )) {
      // Convert relative path to absolute path for consistency
      const absolutePath = path.join(this.options.vaultPath, file.filePath);
      currentPaths.add(absolutePath);
      const indexedModified = indexedPaths.get(absolutePath);

      if (!indexedModified) {
        // New file
        toReindex.push(absolutePath);
      } else {
        // Check if file is newer than indexed modified time
        const fileTime = file.mtime.toISOString();
        if (fileTime > indexedModified) {
          toReindex.push(absolutePath);
        }
      }
    }

    // Find deleted files (indexed but not on disk)
    for (const [filePath] of indexedPaths) {
      if (!currentPaths.has(filePath)) {
        // File was deleted while watcher was offline
        const row = this.options.db.getOne<{ note_id: string }>(
          'SELECT note_id FROM notes WHERE file_path = ?',
          [filePath]
        );
        if (row) {
          deleteNote(this.options.db, row.note_id);
          if (this.options.typesenseClient) {
            void deleteFromTypesense(this.options.typesenseClient, row.note_id);
          }
        }
      }
    }

    // Re-index changed/new files
    for (const filePath of toReindex) {
      try {
        const result = await readNote(filePath);
        if (!isAnvilError(result)) {
          upsertNote(this.options.db, result.note);
        }
      } catch (err) {
        // Log but continue
        console.error(`[watcher] Catchup failed for ${filePath}:`, err);
      }
    }
  }

  /**
   * Watch the .anvil/types directory for type definition changes.
   * Reloads the type registry on any change.
   */
  private watchTypeDefinitions(): void {
    const typesDir = path.join(this.options.vaultPath, '.anvil', 'types');
    const typeWatcher = chokidar.watch(typesDir, {
      persistent: true,
      ignoreInitial: true,
    });

    typeWatcher.on('all', async () => {
      // Reload type registry on any change to type YAML files
      await this.options.registry.loadTypes(typesDir);
      // Re-validate existing notes (warn mode) — just log, don't crash
      console.log('[watcher] Type definitions reloaded');
    });
  }

  /**
   * Build chokidar-compatible ignore patterns
   */
  private buildIgnorePatterns(): (string | RegExp)[] {
    const patterns = this.options.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS;
    return [
      ...patterns,
      /(^|[/\\])\../,  // hidden files
    ];
  }

  /**
   * Build string array of ignore patterns for scanVault
   */
  private buildIgnorePatternsArray(): string[] {
    return this.options.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS;
  }
}
