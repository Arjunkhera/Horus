/**
 * Tests for the type discovery endpoints.
 *
 * All 4 endpoints are public (no auth required).
 *
 * Coverage:
 *   - GET /types                          → 200, list of all 5 V1 types
 *   - GET /types/:typeId                  → 200 known, 404 unknown
 *   - GET /types/:typeId/schema           → 200 known, 404 unknown
 *   - GET /types/:typeId/relationships    → 200 known, 404 unknown
 *   - ETag header present on all 200 responses
 *   - Cache-Control header present on all 200 responses
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import type { StorageBackend, BundleFiles, StoredBundle } from '../src/storage/types.js';
import type { AuditLog } from '../src/audit/audit-log.js';
import type { AuthStrategy } from '../src/auth/types.js';
import type { PublishPipeline } from '../src/pipeline/publish-pipeline.js';
import type { ServiceConfig } from '../src/config.js';
import type { ServiceUser } from '../src/types.js';

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

const stubStorage: StorageBackend = {
  exists: async () => false,
  writeBundle: async () => {},
  readBundle: async () => { throw new Error('not found'); },
  listVersions: async () => [],
  listArtifacts: async () => [],
  healthCheck: async () => ({ ok: true }),
};

const stubAuditLog: AuditLog = {
  append: async () => {},
};

const stubAuth: AuthStrategy = {
  identify: () => null,
  authorize: () => 'allow',
};

const stubPipeline = {} as PublishPipeline;

const stubConfig: ServiceConfig = {
  port: 3000,
  host: '0.0.0.0',
  logLevel: 'silent',
  serviceVersion: '1.0.0',
  storage: { type: 'memory' } as ServiceConfig['storage'],
  auth: { type: 'none' } as ServiceConfig['auth'],
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Type discovery endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = createApp({
      config: stubConfig,
      storage: stubStorage,
      auth: stubAuth,
      auditLog: stubAuditLog,
      pipeline: stubPipeline,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── GET /types ────────────────────────────────────────────────────────────

  describe('GET /types', () => {
    it('returns 200 with all 5 V1 types', async () => {
      const res = await app.inject({ method: 'GET', url: '/types' });
      expect(res.statusCode).toBe(200);

      const body = res.json<Array<{ typeId: string; name: string; description: string; schemaVersion: string }>>();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(5);

      const typeIds = body.map((t) => t.typeId);
      expect(typeIds).toContain('skill');
      expect(typeIds).toContain('agent');
      expect(typeIds).toContain('plugin');
      expect(typeIds).toContain('persona');
      expect(typeIds).toContain('workspace-config');
    });

    it('each entry has required fields', async () => {
      const res = await app.inject({ method: 'GET', url: '/types' });
      const body = res.json<Array<Record<string, unknown>>>();
      for (const entry of body) {
        expect(typeof entry.typeId).toBe('string');
        expect(typeof entry.name).toBe('string');
        expect(typeof entry.description).toBe('string');
        expect(typeof entry.schemaVersion).toBe('string');
        // schema and allowedReferenceTargets should NOT be exposed in the list
        expect('schema' in entry).toBe(false);
        expect('allowedReferenceTargets' in entry).toBe(false);
      }
    });

    it('includes ETag header', async () => {
      const res = await app.inject({ method: 'GET', url: '/types' });
      expect(res.headers['etag']).toBeTruthy();
    });

    it('includes Cache-Control header', async () => {
      const res = await app.inject({ method: 'GET', url: '/types' });
      expect(res.headers['cache-control']).toBe('max-age=3600');
    });
  });

  // ── GET /types/:typeId ────────────────────────────────────────────────────

  describe('GET /types/:typeId', () => {
    it('returns 200 with metadata for a known type', async () => {
      const res = await app.inject({ method: 'GET', url: '/types/skill' });
      expect(res.statusCode).toBe(200);

      const body = res.json<Record<string, unknown>>();
      expect(body.typeId).toBe('skill');
      expect(typeof body.name).toBe('string');
      expect(typeof body.description).toBe('string');
      expect(typeof body.schemaVersion).toBe('string');
    });

    it('returns 404 for an unknown type', async () => {
      const res = await app.inject({ method: 'GET', url: '/types/nonexistent-type' });
      expect(res.statusCode).toBe(404);

      const body = res.json<{ error: string; message: string }>();
      expect(body.error).toBe('UNKNOWN_TYPE');
      expect(body.message).toContain('nonexistent-type');
    });

    it('includes ETag header on 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/types/agent' });
      expect(res.headers['etag']).toBeTruthy();
    });

    it('includes Cache-Control header on 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/types/agent' });
      expect(res.headers['cache-control']).toBe('max-age=3600');
    });
  });

  // ── GET /types/:typeId/schema ─────────────────────────────────────────────

  describe('GET /types/:typeId/schema', () => {
    it('returns 200 with a JSON Schema object for a known type', async () => {
      const res = await app.inject({ method: 'GET', url: '/types/skill/schema' });
      expect(res.statusCode).toBe(200);

      const body = res.json<Record<string, unknown>>();
      // JSON Schema must have at minimum a "type" or "$schema" or "properties"
      expect(body).toBeTruthy();
      // zod-to-json-schema wraps with a $schema or definitions key
      const hasSchemaStructure =
        'type' in body || 'properties' in body || '$schema' in body || 'definitions' in body;
      expect(hasSchemaStructure).toBe(true);
    });

    it('returns 404 for an unknown type', async () => {
      const res = await app.inject({ method: 'GET', url: '/types/bogus/schema' });
      expect(res.statusCode).toBe(404);

      const body = res.json<{ error: string }>();
      expect(body.error).toBe('UNKNOWN_TYPE');
    });

    it('includes ETag header on 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/types/plugin/schema' });
      expect(res.headers['etag']).toBeTruthy();
    });

    it('includes Cache-Control header on 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/types/plugin/schema' });
      expect(res.headers['cache-control']).toBe('max-age=3600');
    });

    it('returns schema for every V1 type', async () => {
      const types = ['skill', 'agent', 'plugin', 'persona', 'workspace-config'];
      for (const typeId of types) {
        const res = await app.inject({ method: 'GET', url: `/types/${typeId}/schema` });
        expect(res.statusCode, `expected 200 for ${typeId}`).toBe(200);
      }
    });
  });

  // ── GET /types/:typeId/relationships ──────────────────────────────────────

  describe('GET /types/:typeId/relationships', () => {
    it('returns 200 with allowedReferenceTargets for a known type', async () => {
      const res = await app.inject({ method: 'GET', url: '/types/skill/relationships' });
      expect(res.statusCode).toBe(200);

      const body = res.json<{ typeId: string; allowedReferenceTargets: string[] }>();
      expect(body.typeId).toBe('skill');
      expect(Array.isArray(body.allowedReferenceTargets)).toBe(true);
    });

    it('skill has no reference targets', async () => {
      const res = await app.inject({ method: 'GET', url: '/types/skill/relationships' });
      const body = res.json<{ allowedReferenceTargets: string[] }>();
      expect(body.allowedReferenceTargets).toEqual([]);
    });

    it('agent references skill', async () => {
      const res = await app.inject({ method: 'GET', url: '/types/agent/relationships' });
      const body = res.json<{ allowedReferenceTargets: string[] }>();
      expect(body.allowedReferenceTargets).toEqual(['skill']);
    });

    it('plugin references skill', async () => {
      const res = await app.inject({ method: 'GET', url: '/types/plugin/relationships' });
      const body = res.json<{ allowedReferenceTargets: string[] }>();
      expect(body.allowedReferenceTargets).toEqual(['skill']);
    });

    it('persona has no reference targets', async () => {
      const res = await app.inject({ method: 'GET', url: '/types/persona/relationships' });
      const body = res.json<{ allowedReferenceTargets: string[] }>();
      expect(body.allowedReferenceTargets).toEqual([]);
    });

    it('workspace-config references plugin and skill', async () => {
      const res = await app.inject({ method: 'GET', url: '/types/workspace-config/relationships' });
      const body = res.json<{ allowedReferenceTargets: string[] }>();
      expect(body.allowedReferenceTargets).toEqual(['plugin', 'skill']);
    });

    it('returns 404 for an unknown type', async () => {
      const res = await app.inject({ method: 'GET', url: '/types/unknown/relationships' });
      expect(res.statusCode).toBe(404);

      const body = res.json<{ error: string }>();
      expect(body.error).toBe('UNKNOWN_TYPE');
    });

    it('includes ETag header on 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/types/persona/relationships' });
      expect(res.headers['etag']).toBeTruthy();
    });

    it('includes Cache-Control header on 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/types/persona/relationships' });
      expect(res.headers['cache-control']).toBe('max-age=3600');
    });
  });

  // ── ETag consistency ──────────────────────────────────────────────────────

  describe('ETag consistency', () => {
    it('all /types endpoints return the same ETag value', async () => {
      const urls = [
        '/types',
        '/types/skill',
        '/types/skill/schema',
        '/types/skill/relationships',
      ];
      const etags = await Promise.all(
        urls.map(async (url) => {
          const res = await app.inject({ method: 'GET', url });
          return res.headers['etag'];
        }),
      );
      const unique = new Set(etags);
      expect(unique.size).toBe(1);
    });
  });
});
