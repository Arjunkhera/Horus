// Unit tests for QMDAdapter in HTTP daemon mode (REST /query endpoint).
// Spins up a minimal REST server to verify the adapter routes
// search/vector/hybrid calls correctly.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { QMDAdapter } from '../../src/core/search/qmd-adapter.js';

// ── Minimal fake QMD REST server ────────────────────────────────────────────

function startFakeRestServer(
  port: number,
  handler: (searches: Array<{ type: string; query: string }>, collections: string[], limit: number) => unknown[]
): { server: Server; calls: Array<{ searches: Array<{ type: string; query: string }>; collections: string[]; limit: number }> } {
  const calls: Array<{ searches: Array<{ type: string; query: string }>; collections: string[]; limit: number }> = [];

  const server = createServer((req, res) => {
    if (req.url !== '/query' || req.method !== 'POST') {
      res.writeHead(404);
      res.end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      const searches = (body['searches'] ?? []) as Array<{ type: string; query: string }>;
      const collections = (body['collections'] ?? []) as string[];
      const limit = (body['limit'] ?? 10) as number;
      calls.push({ searches, collections, limit });

      const results = handler(searches, collections, limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results }));
    });
  });

  server.listen(port);
  return { server, calls };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('QMDAdapter HTTP daemon mode (REST)', () => {
  let server: Server;
  let calls: Array<{ searches: Array<{ type: string; query: string }>; collections: string[]; limit: number }>;
  let adapter: QMDAdapter;
  let port: number;

  const fakeResult = { docid: '#abc', file: 'anvil/note.md', title: 'Test Note', score: 0.9, snippet: 'test snippet' };

  beforeEach(async () => {
    const fake = startFakeRestServer(0, () => [fakeResult]);
    server = fake.server;
    calls = fake.calls;
    await new Promise<void>((resolve) => {
      if (server.listening) { resolve(); return; }
      server.once('listening', resolve);
    });
    port = (server.address() as { port: number }).port;
    adapter = new QMDAdapter({ collectionName: 'anvil', daemonUrl: `http://localhost:${port}` });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('routes query() to lex + vec searches (deep_search)', async () => {
    const results = await adapter.query('knowledge management', { limit: 5 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.searches).toEqual([
      { type: 'lex', query: 'knowledge management' },
      { type: 'vec', query: 'knowledge management' },
    ]);
    expect(calls[0]!.collections).toEqual(['anvil']);
    expect(calls[0]!.limit).toBe(5);
    expect(results[0]!.score).toBe(0.9);
    expect(results[0]!.file).toBe('anvil/note.md');
  });

  it('routes search() to lex search', async () => {
    await adapter.search('anvil notes', { limit: 10 });
    expect(calls[0]!.searches).toEqual([{ type: 'lex', query: 'anvil notes' }]);
    expect(calls[0]!.collections).toEqual(['anvil']);
    expect(calls[0]!.limit).toBe(10);
  });

  it('routes similar() to vec search', async () => {
    await adapter.similar('semantic meaning');
    expect(calls[0]!.searches).toEqual([{ type: 'vec', query: 'semantic meaning' }]);
    expect(calls[0]!.collections).toEqual(['anvil']);
  });

  it('normalizes results to SearchResult format', async () => {
    const results = await adapter.query('test');
    expect(results[0]).toMatchObject({ score: 0.9, file: 'anvil/note.md', snippet: 'test snippet' });
    // noteId has the collection prefix stripped so it matches notes.file_path in SQLite
    expect(results[0]!.noteId).toBe('note.md');
  });

  it('returns empty array when daemon returns no results', async () => {
    const emptyFake = startFakeRestServer(0, () => []);
    await new Promise<void>((resolve) => {
      if (emptyFake.server.listening) { resolve(); return; }
      emptyFake.server.once('listening', resolve);
    });
    const emptyPort = (emptyFake.server.address() as { port: number }).port;
    const emptyAdapter = new QMDAdapter({ collectionName: 'anvil', daemonUrl: `http://localhost:${emptyPort}` });
    const results = await emptyAdapter.query('nothing');
    expect(results).toHaveLength(0);
    await new Promise<void>((resolve) => emptyFake.server.close(() => resolve()));
  });

  it('preserves collection namespacing', async () => {
    const customAdapter = new QMDAdapter({ collectionName: 'custom', daemonUrl: `http://localhost:${port}` });
    await customAdapter.query('test');
    expect(calls[0]!.collections).toEqual(['custom']);
  });
});

describe('QMDAdapter.isAvailable() with daemon URL', () => {
  it('returns true when QMD_DAEMON_URL is set, skipping subprocess probe', async () => {
    const original = process.env['QMD_DAEMON_URL'];
    process.env['QMD_DAEMON_URL'] = 'http://localhost:8181';
    try {
      const available = await QMDAdapter.isAvailable();
      expect(available).toBe(true);
    } finally {
      if (original === undefined) delete process.env['QMD_DAEMON_URL'];
      else process.env['QMD_DAEMON_URL'] = original;
    }
  });

  it('returns false when qmd binary is not found and no daemon URL', async () => {
    const available = await QMDAdapter.isAvailable('/nonexistent/qmd-binary');
    expect(available).toBe(false);
  });
});
