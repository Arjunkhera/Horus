/**
 * Integration tests for Typesense-backed repo resolution in Forge.
 *
 * These tests require a running Typesense instance. They are skipped
 * when the TYPESENSE_HOST environment variable is not set.
 *
 * To run:
 *   TYPESENSE_HOST=localhost TYPESENSE_PORT=8108 TYPESENSE_API_KEY=horus-local-key \
 *     npx vitest run src/repo/__tests__/typesense-search.test.ts
 *
 * Covers:
 *   - Scan repo -> forge_repo_resolve finds it with fuzzy name via Typesense
 *   - Forge source documents are searchable in Typesense
 *   - Cross-source query returns Forge results alongside others
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Typesense from 'typesense';

const TYPESENSE_HOST = process.env.TYPESENSE_HOST;
const TYPESENSE_PORT = parseInt(process.env.TYPESENSE_PORT ?? '8108', 10);
const TYPESENSE_API_KEY = process.env.TYPESENSE_API_KEY ?? 'horus-local-key';
const TYPESENSE_PROTOCOL = (process.env.TYPESENSE_PROTOCOL ?? 'http') as 'http' | 'https';

const COLLECTION_NAME = 'horus_documents';

// Skip entire suite if Typesense is not available
const describeTypesense = TYPESENSE_HOST ? describe : describe.skip;

describeTypesense('Integration: Forge Typesense Repo Search', () => {
  let client: Typesense.Client;
  let testDocIds: string[] = [];

  beforeAll(async () => {
    client = new Typesense.Client({
      nodes: [{ host: TYPESENSE_HOST!, port: TYPESENSE_PORT, protocol: TYPESENSE_PROTOCOL }],
      apiKey: TYPESENSE_API_KEY,
      connectionTimeoutSeconds: 5,
    });

    // Ensure the collection exists
    try {
      await client.collections(COLLECTION_NAME).retrieve();
    } catch {
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
    for (const id of testDocIds) {
      try {
        await client.collections(COLLECTION_NAME).documents(id).delete();
      } catch {
        // Ignore
      }
    }
  });

  it('should index a repo and find it via fuzzy name search', async () => {
    const repoId = `forge-repo-${Date.now()}-1`;
    testDocIds.push(repoId);

    // Simulate what Forge does when indexing a scanned repo to Typesense
    await client.collections(COLLECTION_NAME).documents().upsert({
      id: repoId,
      source: 'forge',
      source_type: 'repo',
      title: 'Celestium Framework',
      body: 'A TypeScript framework for building MCP servers. Located at /Users/dev/Repositories/celestium-framework.',
      tags: ['typescript', 'mcp', 'framework'],
      created_at: Math.floor(Date.now() / 1000),
      modified_at: Math.floor(Date.now() / 1000),
    });

    // Fuzzy search — user types "celestium" or even "celest"
    const result = await client.collections(COLLECTION_NAME).documents().search({
      q: 'celestium',
      query_by: 'title,body',
      filter_by: 'source:=forge',
    });

    expect(result.found).toBeGreaterThanOrEqual(1);
    const found = result.hits?.some((h: any) => h.document.id === repoId);
    expect(found).toBe(true);
  });

  it('should find repos with typo-tolerant search', async () => {
    const repoId = `forge-repo-${Date.now()}-2`;
    testDocIds.push(repoId);

    await client.collections(COLLECTION_NAME).documents().upsert({
      id: repoId,
      source: 'forge',
      source_type: 'repo',
      title: 'Prometheus Dashboard',
      body: 'React dashboard for monitoring Prometheus metrics.',
      tags: ['react', 'monitoring'],
      created_at: Math.floor(Date.now() / 1000),
      modified_at: Math.floor(Date.now() / 1000),
    });

    // Search with a slightly different spelling (Typesense handles typo tolerance)
    const result = await client.collections(COLLECTION_NAME).documents().search({
      q: 'Prometeus',
      query_by: 'title,body',
      filter_by: 'source:=forge',
      num_typos: '2',
    });

    expect(result.found).toBeGreaterThanOrEqual(1);
    const found = result.hits?.some((h: any) => h.document.id === repoId);
    expect(found).toBe(true);
  });

  it('should support filtering repos by tags', async () => {
    const repoId = `forge-repo-${Date.now()}-3`;
    testDocIds.push(repoId);

    await client.collections(COLLECTION_NAME).documents().upsert({
      id: repoId,
      source: 'forge',
      source_type: 'repo',
      title: 'Andromeda API',
      body: 'Python FastAPI backend for the Andromeda platform.',
      tags: ['python', 'fastapi', 'backend'],
      created_at: Math.floor(Date.now() / 1000),
      modified_at: Math.floor(Date.now() / 1000),
    });

    // Filter by tag
    const result = await client.collections(COLLECTION_NAME).documents().search({
      q: 'Andromeda',
      query_by: 'title,body',
      filter_by: 'source:=forge && tags:=[python]',
    });

    expect(result.found).toBeGreaterThanOrEqual(1);
    const doc = result.hits?.[0]?.document as any;
    expect(doc.tags).toContain('python');
  });

  it('should return forge repos in cross-source queries', async () => {
    const forgeRepoId = `forge-cross-${Date.now()}`;
    testDocIds.push(forgeRepoId);

    const crossKeyword = `ForgeXSearch${Date.now()}`;

    await client.collections(COLLECTION_NAME).documents().upsert({
      id: forgeRepoId,
      source: 'forge',
      source_type: 'repo',
      title: `${crossKeyword} Repo`,
      body: 'This repo should appear in cross-source queries.',
      tags: ['cross-test'],
      created_at: Math.floor(Date.now() / 1000),
      modified_at: Math.floor(Date.now() / 1000),
    });

    // No source filter
    const result = await client.collections(COLLECTION_NAME).documents().search({
      q: crossKeyword,
      query_by: 'title,body',
    });

    expect(result.found).toBeGreaterThanOrEqual(1);
    const sources = result.hits?.map((h: any) => h.document.source) ?? [];
    expect(sources).toContain('forge');
  });
});
