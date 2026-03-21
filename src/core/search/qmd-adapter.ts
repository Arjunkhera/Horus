// QMD adapter for semantic search.
// Implements SearchEngine interface. Supports two modes:
//   - HTTP mode: when QMD_DAEMON_URL (or opts.daemonUrl) is set, routes search
//     calls to the shared QMD MCP HTTP daemon. Models stay warm; no subprocess spawned.
//   - Subprocess mode: original behaviour — spawns qmd CLI for each request.
// Collection management (ensureCollection, reindex, registerContexts) always uses
// subprocess so that Anvil writes to the shared SQLite database the daemon reads from.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SearchEngine, SearchOptions, SearchResult } from './engine.js';
import { QMDMcpClient } from './qmd-mcp-client.js';

const execFileAsync = promisify(execFile);

export interface QMDAdapterOptions {
  collectionName?: string;
  qmdPath?: string;
  maxBuffer?: number;
  /** If set, search calls go to the QMD HTTP daemon at this URL instead of subprocess. */
  daemonUrl?: string;
}

export class QMDAdapter implements SearchEngine {
  private collectionName: string;
  private qmdPath: string;
  private maxBuffer: number;
  /** Non-null when operating in HTTP daemon mode. */
  readonly mcpClient: QMDMcpClient | null;

  constructor(opts: QMDAdapterOptions = {}) {
    this.collectionName = opts.collectionName ?? 'anvil';
    this.qmdPath = opts.qmdPath ?? 'qmd';
    this.maxBuffer = opts.maxBuffer ?? 10 * 1024 * 1024; // 10MB

    const daemonUrl = opts.daemonUrl ?? process.env['QMD_DAEMON_URL'];
    this.mcpClient = daemonUrl ? new QMDMcpClient(daemonUrl) : null;
  }

  /**
   * Full semantic query — expansion + reranking.
   * HTTP mode: deep_search MCP tool. Subprocess mode: `qmd query`.
   */
  async query(text: string, opts?: SearchOptions): Promise<SearchResult[]> {
    if (this.mcpClient) {
      const results = await this.mcpClient.callTool('deep_search', {
        query: text,
        collection: this.collectionName,
        ...(opts?.limit ? { limit: opts.limit } : {}),
      });
      return this.normalizeResults(results);
    }
    const args = ['query', text, '--json', '-c', this.collectionName];
    if (opts?.limit) args.push('-n', String(opts.limit));
    if (opts?.path) args.push('--path', opts.path);
    return this.exec(args);
  }

  /**
   * Fast BM25 keyword search.
   * HTTP mode: search MCP tool. Subprocess mode: `qmd search`.
   */
  async search(text: string, opts?: SearchOptions): Promise<SearchResult[]> {
    if (this.mcpClient) {
      const results = await this.mcpClient.callTool('search', {
        query: text,
        collection: this.collectionName,
        ...(opts?.limit ? { limit: opts.limit } : {}),
      });
      return this.normalizeResults(results);
    }
    const args = ['search', text, '--json', '-c', this.collectionName];
    if (opts?.limit) args.push('-n', String(opts.limit));
    if (opts?.path) args.push('--path', opts.path);
    return this.exec(args);
  }

  /**
   * Vector similarity search.
   * HTTP mode: vector_search MCP tool. Subprocess mode: `qmd vsearch`.
   */
  async similar(text: string, opts?: SearchOptions): Promise<SearchResult[]> {
    if (this.mcpClient) {
      const results = await this.mcpClient.callTool('vector_search', {
        query: text,
        collection: this.collectionName,
        ...(opts?.limit ? { limit: opts.limit } : {}),
      });
      return this.normalizeResults(results);
    }
    const args = ['vsearch', text, '--json', '-c', this.collectionName];
    if (opts?.limit) args.push('-n', String(opts.limit));
    return this.exec(args);
  }

  /**
   * Re-index the collection via `qmd update`.
   * Always uses subprocess so the shared SQLite database is updated
   * and the daemon picks up new documents on the next search request.
   */
  async reindex(): Promise<void> {
    await this.exec(['update', '-c', this.collectionName]);
  }

  /**
   * Ensure collection exists, pointing at the notes directory.
   * Idempotent — if collection exists, this is a no-op.
   * Always uses subprocess (collection registration is infrequent setup).
   */
  async ensureCollection(notesPath: string): Promise<void> {
    await this.exec([
      'collection', 'add', notesPath,
      '--name', this.collectionName,
      '--mask', '**/*.md',
    ]);
  }

  /**
   * Register path-based QMD contexts for better search relevance.
   * Always uses subprocess.
   */
  async registerContexts(notesPath: string): Promise<void> {
    const contexts: Array<[string, string]> = [
      ['/', 'Anvil working memory — SDLC notes, tasks, stories, scratch journals, project documentation'],
      ['/projects', 'Software project directories, each containing stories, scratch journals, specs, and documentation'],
      ['/scratches', 'Global scratch journals — design discussions, ideas, research notes, decisions'],
    ];

    for (const [path, description] of contexts) {
      try {
        await this.exec(['context', 'add', notesPath + path, description]);
      } catch {
        // Ignore errors if context already exists or path doesn't exist
      }
    }
  }

  /**
   * Check if QMD is available.
   * Returns true immediately if QMD_DAEMON_URL is set (no subprocess probe needed).
   * Otherwise checks if the qmd binary is reachable.
   */
  static async isAvailable(qmdPath: string = process.env['QMD_PATH'] ?? 'qmd'): Promise<boolean> {
    if (process.env['QMD_DAEMON_URL']) {
      return true;
    }
    try {
      await execFileAsync(qmdPath, ['--version'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  private async exec(args: string[]): Promise<any> {
    try {
      const { stdout } = await execFileAsync(this.qmdPath, args, {
        maxBuffer: this.maxBuffer,
        timeout: 30000, // 30s timeout
      });

      if (!stdout || !stdout.trim()) {
        return [];
      }

      try {
        const parsed = JSON.parse(stdout);
        return this.normalizeResults(parsed);
      } catch {
        // Not JSON — return empty (some QMD commands return plain text)
        return [];
      }
    } catch (err) {
      // QMD not found or error — caller handles graceful degradation
      throw err;
    }
  }

  /**
   * Normalize QMD output (subprocess JSON or HTTP daemon results) to SearchResult format.
   * QMD returns: { docid, score, file, snippet } or array thereof.
   */
  private normalizeResults(raw: unknown): SearchResult[] {
    if (!Array.isArray(raw)) {
      raw = [raw];
    }

    return (raw as any[])
      .filter(item => item && typeof item === 'object')
      .map(item => ({
        // Prefer file path — resolved to a note UUID via notes.file_path by the search handler.
        // QMD's docid is an internal hash (#abc123) not stored in our DB.
        noteId: this.pathToNoteId(item.file ?? '') || (item.docid ?? item.id ?? ''),
        score: typeof item.score === 'number' ? item.score : 0,
        snippet: typeof item.snippet === 'string' ? item.snippet : (item.content ?? ''),
        file: item.file,
      }));
  }

  private pathToNoteId(filePath: string): string {
    // QMD prefixes file paths with the collection name (e.g., "anvil/note.md").
    // Strip it so the path matches what's stored in notes.file_path.
    const prefix = this.collectionName + '/';
    if (filePath.startsWith(prefix)) {
      return filePath.slice(prefix.length);
    }
    return filePath;
  }
}
