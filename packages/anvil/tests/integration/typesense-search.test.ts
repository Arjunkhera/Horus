/**
 * Integration tests for Typesense search in Anvil.
 *
 * These tests require a running Typesense instance. They are skipped
 * when the TYPESENSE_HOST environment variable is not set.
 *
 * To run:
 *   TYPESENSE_HOST=localhost TYPESENSE_PORT=8108 TYPESENSE_API_KEY=horus-local-key pnpm test -- tests/integration/typesense-search.test.ts
 *
 * Covers:
 *   - Create note -> searchable in Typesense
 *   - Update note -> changes reflected in Typesense
 *   - Delete note -> removed from Typesense
 *   - Cross-source query (no source filter) returns results
 *   - CRUD lifecycle end-to-end
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Typesense from 'typesense';
import type { Client as TypesenseClient } from 'typesense';

const TYPESENSE_HOST = process.env.TYPESENSE_HOST;
const TYPESENSE_PORT = parseInt(process.env.TYPESENSE_PORT ?? '8108', 10);
const TYPESENSE_API_KEY = process.env.TYPESENSE_API_KEY ?? 'horus-local-key';
const TYPESENSE_PROTOCOL = (process.env.TYPESENSE_PROTOCOL ?? 'http') as 'http' | 'https';

const COLLECTION_NAME = 'horus_documents';

// Skip entire suite if Typesense is not available
const describeTypesense = TYPESENSE_HOST ? describe : describe.skip;

describeTypesense('Integration: Anvil Typesense Search', () => {
  let client: TypesenseClient;
  let testDocIds: string[] = [];

  beforeAll(async () => {
    client = new Typesense.Client({
      nodes: [{ host: TYPESENSE_HOST!, port: TYPESENSE_PORT, protocol: TYPESENSE_PROTOCOL }],
      apiKey: TYPESENSE_API_KEY,
      connectionTimeoutSeconds: 5,
    });

    // Ensure the collection exists (bootstrap should have created it)
    try {
      await client.collections(COLLECTION_NAME).retrieve();
    } catch {
      // Collection doesn't exist — create it for testing
      await client.collections().create({
        name: COLLECTION_NAME,
        fields: [
          { name: 'id', type: 'string' },
          { name: 'source', type: 'string', facet: true },
          { name: 'source_type', type: 'string', facet: true },
          { name: 'title', type: 'string' },
          { name: 'body', type: 'string' },
          { name: 'tags', type: 'string[]', facet: true },
          { name: 'status', type: 'string', facet: true, optional: true },
          { name: 'priority', type: 'string', facet: true, optional: true },
          { name: 'assignee_id', type: 'string', facet: true, optional: true },
          { name: 'project_id', type: 'string', facet: true, optional: true },
          { name: 'project_name', type: 'string', optional: true },
          { name: 'due_at', type: 'int64', optional: true },
          { name: 'mode', type: 'string', facet: true, optional: true },
          { name: 'scope_repo', type: 'string', facet: true, optional: true },
          { name: 'scope_program', type: 'string', facet: true, optional: true },
          { name: 'scope_context', type: 'string', facet: true, optional: true },
          { name: 'vault_name', type: 'string', facet: true, optional: true },
          { name: 'created_at', type: 'int64' },
          { name: 'modified_at', type: 'int64', sort: true },
        ],
        default_sorting_field: 'modified_at',
      });
    }
  });

  afterAll(async () => {
    // Clean up test documents
    for (const id of testDocIds) {
      try {
        await client.collections(COLLECTION_NAME).documents(id).delete();
      } catch {
        // Ignore — may already be deleted
      }
    }
  });

  it('should index a note and find it via search', async () => {
    const noteId = `anvil-test-${Date.now()}-1`;
    testDocIds.push(noteId);

    // Simulate what Anvil does when indexing a note to Typesense
    await client.collections(COLLECTION_NAME).documents().upsert({
      id: noteId,
      source: 'anvil',
      source_type: 'task',
      title: 'Typesense Integration Zephyr Task',
      body: 'This task verifies that Typesense search works correctly for Anvil notes.',
      tags: ['integration-test', 'typesense'],
      status: 'open',
      priority: 'P1-high',
      created_at: Math.floor(Date.now() / 1000),
      modified_at: Math.floor(Date.now() / 1000),
    });

    // Search for the unique keyword
    const result = await client.collections(COLLECTION_NAME).documents().search({
      q: 'Zephyr',
      query_by: 'title,body',
      filter_by: 'source:=anvil',
    });

    expect(result.found).toBeGreaterThanOrEqual(1);
    const found = result.hits?.some((h: any) => h.document.id === noteId);
    expect(found).toBe(true);
  });

  it('should reflect updates when a note is modified', async () => {
    const noteId = `anvil-test-${Date.now()}-2`;
    testDocIds.push(noteId);

    // Create initial document
    await client.collections(COLLECTION_NAME).documents().upsert({
      id: noteId,
      source: 'anvil',
      source_type: 'task',
      title: 'Update Test Quasar Note',
      body: 'Original body content for update test.',
      tags: ['update-test'],
      status: 'open',
      created_at: Math.floor(Date.now() / 1000),
      modified_at: Math.floor(Date.now() / 1000),
    });

    // Verify it is searchable
    let result = await client.collections(COLLECTION_NAME).documents().search({
      q: 'Quasar',
      query_by: 'title,body',
    });
    expect(result.found).toBeGreaterThanOrEqual(1);

    // Update the document (simulate note update)
    await client.collections(COLLECTION_NAME).documents().upsert({
      id: noteId,
      source: 'anvil',
      source_type: 'task',
      title: 'Update Test Quasar Note',
      body: 'Updated body content — now includes Nebula keyword.',
      tags: ['update-test'],
      status: 'in-progress',
      created_at: Math.floor(Date.now() / 1000),
      modified_at: Math.floor(Date.now() / 1000),
    });

    // Search for the new keyword
    result = await client.collections(COLLECTION_NAME).documents().search({
      q: 'Nebula',
      query_by: 'title,body',
      filter_by: `id:=${noteId}`,
    });
    expect(result.found).toBeGreaterThanOrEqual(1);

    // Verify status was updated
    const doc = await client.collections(COLLECTION_NAME).documents(noteId).retrieve();
    expect((doc as any).status).toBe('in-progress');
  });

  it('should remove a note from search when deleted', async () => {
    const noteId = `anvil-test-${Date.now()}-3`;

    // Create document
    await client.collections(COLLECTION_NAME).documents().upsert({
      id: noteId,
      source: 'anvil',
      source_type: 'note',
      title: 'Delete Test Pulsar Note',
      body: 'This note should be removed from Typesense after deletion.',
      tags: ['delete-test'],
      created_at: Math.floor(Date.now() / 1000),
      modified_at: Math.floor(Date.now() / 1000),
    });

    // Verify it exists
    let result = await client.collections(COLLECTION_NAME).documents().search({
      q: 'Pulsar',
      query_by: 'title,body',
      filter_by: `id:=${noteId}`,
    });
    expect(result.found).toBeGreaterThanOrEqual(1);

    // Delete it
    await client.collections(COLLECTION_NAME).documents(noteId).delete();

    // Verify it is gone
    result = await client.collections(COLLECTION_NAME).documents().search({
      q: 'Pulsar',
      query_by: 'title,body',
      filter_by: `id:=${noteId}`,
    });
    expect(result.found).toBe(0);
  });

  it('should support cross-source queries (no source filter)', async () => {
    const anvilNoteId = `anvil-cross-${Date.now()}`;
    const vaultNoteId = `vault-cross-${Date.now()}`;
    const forgeNoteId = `forge-cross-${Date.now()}`;
    testDocIds.push(anvilNoteId, vaultNoteId, forgeNoteId);

    const crossKeyword = `CrossSystem${Date.now()}`;

    // Insert documents from all three sources
    const docs = [
      {
        id: anvilNoteId,
        source: 'anvil',
        source_type: 'task',
        title: `Anvil ${crossKeyword} Task`,
        body: 'Cross-system search test from Anvil.',
        tags: ['cross-test'],
        created_at: Math.floor(Date.now() / 1000),
        modified_at: Math.floor(Date.now() / 1000),
      },
      {
        id: vaultNoteId,
        source: 'vault',
        source_type: 'repo-profile',
        title: `Vault ${crossKeyword} Page`,
        body: 'Cross-system search test from Vault.',
        tags: ['cross-test'],
        mode: 'reference',
        created_at: Math.floor(Date.now() / 1000),
        modified_at: Math.floor(Date.now() / 1000),
      },
      {
        id: forgeNoteId,
        source: 'forge',
        source_type: 'repo',
        title: `Forge ${crossKeyword} Repo`,
        body: 'Cross-system search test from Forge.',
        tags: ['cross-test'],
        created_at: Math.floor(Date.now() / 1000),
        modified_at: Math.floor(Date.now() / 1000),
      },
    ];

    for (const doc of docs) {
      await client.collections(COLLECTION_NAME).documents().upsert(doc);
    }

    // Search without source filter — should return results from all three
    const result = await client.collections(COLLECTION_NAME).documents().search({
      q: crossKeyword,
      query_by: 'title,body',
    });

    expect(result.found).toBeGreaterThanOrEqual(3);

    const sources = new Set(result.hits?.map((h: any) => h.document.source));
    expect(sources.has('anvil')).toBe(true);
    expect(sources.has('vault')).toBe(true);
    expect(sources.has('forge')).toBe(true);
  });

  it('should support filtering by source', async () => {
    const noteId = `anvil-filter-${Date.now()}`;
    testDocIds.push(noteId);

    await client.collections(COLLECTION_NAME).documents().upsert({
      id: noteId,
      source: 'anvil',
      source_type: 'task',
      title: 'Source Filter Vortex Test',
      body: 'Testing source-based filtering.',
      tags: ['filter-test'],
      status: 'open',
      created_at: Math.floor(Date.now() / 1000),
      modified_at: Math.floor(Date.now() / 1000),
    });

    // Filter by source=anvil
    const result = await client.collections(COLLECTION_NAME).documents().search({
      q: 'Vortex',
      query_by: 'title,body',
      filter_by: 'source:=anvil',
    });

    expect(result.found).toBeGreaterThanOrEqual(1);
    for (const hit of result.hits ?? []) {
      expect((hit.document as any).source).toBe('anvil');
    }
  });

  it('should support filtering by tags', async () => {
    const noteId = `anvil-tags-${Date.now()}`;
    testDocIds.push(noteId);

    await client.collections(COLLECTION_NAME).documents().upsert({
      id: noteId,
      source: 'anvil',
      source_type: 'task',
      title: 'Tag Filter Aurora Test',
      body: 'Testing tag-based filtering.',
      tags: ['aurora-special', 'integration-test'],
      status: 'open',
      created_at: Math.floor(Date.now() / 1000),
      modified_at: Math.floor(Date.now() / 1000),
    });

    // Filter by tag
    const result = await client.collections(COLLECTION_NAME).documents().search({
      q: 'Aurora',
      query_by: 'title,body',
      filter_by: 'tags:=[aurora-special]',
    });

    expect(result.found).toBeGreaterThanOrEqual(1);
    const doc = result.hits?.[0]?.document as any;
    expect(doc.tags).toContain('aurora-special');
  });
});
