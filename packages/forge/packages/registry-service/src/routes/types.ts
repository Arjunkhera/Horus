/**
 * Type discovery endpoints (public, no authentication required).
 *
 * GET /types                     → list all V1 types (lightweight)
 * GET /types/:typeId             → metadata for one type
 * GET /types/:typeId/schema      → JSON Schema for the type's metadata shape
 * GET /types/:typeId/relationships → allowed reference targets per type
 *
 * All responses carry:
 *   ETag            — SHA-256 of the serialised type registry (computed once at import time)
 *   Cache-Control   — max-age=3600
 *
 * Requirements: R6 (public read, no auth), caching headers.
 */

import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ArtifactType } from '@forge/core';
import { TYPE_REGISTRY_LIST, TYPE_REGISTRY_MAP } from '../types/type-registry.js';

// ---------------------------------------------------------------------------
// ETag — computed once at process start from the serialised registry
// ---------------------------------------------------------------------------

const REGISTRY_ETAG = (() => {
  const snapshot = JSON.stringify(
    TYPE_REGISTRY_LIST.map((e) => ({
      typeId: e.typeId,
      name: e.name,
      description: e.description,
      schemaVersion: e.schemaVersion,
      allowedReferenceTargets: e.allowedReferenceTargets,
    })),
  );
  return `"${createHash('sha256').update(snapshot).digest('hex')}"`;
})();

const CACHE_CONTROL = 'max-age=3600';

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerTypeRoutes(app: FastifyInstance): void {
  // ── Shared caching helpers ──────────────────────────────────────────────

  function addCacheHeaders(reply: { header: (k: string, v: string) => unknown }): void {
    reply.header('ETag', REGISTRY_ETAG);
    reply.header('Cache-Control', CACHE_CONTROL);
  }

  // ── GET /types ──────────────────────────────────────────────────────────
  app.get('/types', async (_request, reply) => {
    addCacheHeaders(reply);
    const list = TYPE_REGISTRY_LIST.map((e) => ({
      typeId: e.typeId,
      name: e.name,
      description: e.description,
      schemaVersion: e.schemaVersion,
    }));
    return reply.status(200).send(list);
  });

  // ── GET /types/:typeId ──────────────────────────────────────────────────
  app.get<{ Params: { typeId: string } }>('/types/:typeId', async (request, reply) => {
    const { typeId } = request.params;
    const entry = TYPE_REGISTRY_MAP.get(typeId as ArtifactType);

    if (!entry) {
      return reply.status(404).send({
        error: 'UNKNOWN_TYPE',
        message: `Unknown artifact type '${typeId}'. Valid types are: ${[...TYPE_REGISTRY_MAP.keys()].join(', ')}`,
      });
    }

    addCacheHeaders(reply);
    return reply.status(200).send({
      typeId: entry.typeId,
      name: entry.name,
      description: entry.description,
      schemaVersion: entry.schemaVersion,
    });
  });

  // ── GET /types/:typeId/schema ───────────────────────────────────────────
  app.get<{ Params: { typeId: string } }>('/types/:typeId/schema', async (request, reply) => {
    const { typeId } = request.params;
    const entry = TYPE_REGISTRY_MAP.get(typeId as ArtifactType);

    if (!entry) {
      return reply.status(404).send({
        error: 'UNKNOWN_TYPE',
        message: `Unknown artifact type '${typeId}'. Valid types are: ${[...TYPE_REGISTRY_MAP.keys()].join(', ')}`,
      });
    }

    addCacheHeaders(reply);
    const jsonSchema = zodToJsonSchema(entry.schema, {
      name: entry.typeId,
      errorMessages: false,
    });
    return reply.status(200).send(jsonSchema);
  });

  // ── GET /types/:typeId/relationships ────────────────────────────────────
  app.get<{ Params: { typeId: string } }>('/types/:typeId/relationships', async (request, reply) => {
    const { typeId } = request.params;
    const entry = TYPE_REGISTRY_MAP.get(typeId as ArtifactType);

    if (!entry) {
      return reply.status(404).send({
        error: 'UNKNOWN_TYPE',
        message: `Unknown artifact type '${typeId}'. Valid types are: ${[...TYPE_REGISTRY_MAP.keys()].join(', ')}`,
      });
    }

    addCacheHeaders(reply);
    return reply.status(200).send({
      typeId: entry.typeId,
      allowedReferenceTargets: entry.allowedReferenceTargets,
    });
  });
}
