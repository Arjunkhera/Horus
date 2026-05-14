/**
 * GET  /artifacts/:type/:id/:version           — read a bundle
 * HEAD /artifacts/:type/:id/:version           — existence check
 * GET  /artifacts/:type/:id/versions           — list all semver versions
 * GET  /artifacts/:type/:id/:version/resources/* — read a resource file
 */

import type { FastifyInstance } from 'fastify';
import type { StorageBackend } from '../storage/types.js';
import type { AuditLog } from '../audit/audit-log.js';
import type { AuthStrategy } from '../auth/types.js';
import type { ArtifactType } from '@forge/core';
import { SUPPORTED_TYPES } from '../pipeline/publish-pipeline.js';

interface ArtifactParams {
  type: string;
  id: string;
  version: string;
}

interface ArtifactIdParams {
  type: string;
  id: string;
}

interface ResourceParams {
  type: string;
  id: string;
  version: string;
  '*': string;
}

export function registerReadRoutes(
  app: FastifyInstance,
  storage: StorageBackend,
  auditLog: AuditLog,
  auth: AuthStrategy,
  strategyName = 'builtin',
): void {
  // ── HEAD /artifacts/:type/:id/:version ─────────────────────────────────
  app.head<{ Params: ArtifactParams }>(
    '/artifacts/:type/:id/:version',
    async (request, reply) => {
      const { type, id, version } = request.params;

      if (!SUPPORTED_TYPES.includes(type as ArtifactType)) {
        return reply.status(400).send({
          error: 'UNKNOWN_TYPE',
          message: `Unknown artifact type '${type}'`,
          supportedTypes: SUPPORTED_TYPES,
        });
      }

      // Authorize read
      const decision = auth.authorize(request.serviceUser ?? null, 'read', {
        type,
        id,
        version,
      });
      if (decision === 'deny') {
        return reply.status(403).send({ error: 'FORBIDDEN', message: 'Read access denied' });
      }

      const exists = await storage.exists(type as ArtifactType, id, version);
      if (!exists) {
        return reply.status(404).send();
      }
      return reply.status(200).send();
    },
  );

  // ── GET /artifacts/:type/:id/:version ──────────────────────────────────
  app.get<{ Params: ArtifactParams }>(
    '/artifacts/:type/:id/:version',
    async (request, reply) => {
      const { type, id, version } = request.params;

      if (!SUPPORTED_TYPES.includes(type as ArtifactType)) {
        return reply.status(400).send({
          error: 'UNKNOWN_TYPE',
          message: `Unknown artifact type '${type}'`,
          supportedTypes: SUPPORTED_TYPES,
        });
      }

      // Authorize read
      const decision = auth.authorize(request.serviceUser ?? null, 'read', {
        type,
        id,
        version,
      });
      if (decision === 'deny') {
        return reply.status(403).send({ error: 'FORBIDDEN', message: 'Read access denied' });
      }

      let bundle;
      try {
        bundle = await storage.readBundle(type as ArtifactType, id, version);
      } catch {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Artifact '${type}:${id}@${version}' not found`,
        });
      }

      // Audit read
      const actorId = request.serviceUser?.userId ?? 'anonymous';
      await auditLog.append({
        strategy: strategyName,
        actor: actorId,
        action: 'read',
        resource: `${type}:${id}@${version}`,
        decision: 'permit',
        targetType: type,
        targetId: id,
        targetVersion: version,
        timestamp: new Date().toISOString(),
      });

      // Serialize bundle: filename → base64-encoded content
      const files: Record<string, string> = {};
      for (const [filename, buf] of bundle) {
        files[filename] = buf.toString('base64');
      }

      return reply.status(200).send({
        type,
        id,
        version,
        files,
      });
    },
  );

  // ── GET /artifacts/:type/:id/versions ──────────────────────────────────────
  app.get<{ Params: ArtifactIdParams }>(
    '/artifacts/:type/:id/versions',
    async (request, reply) => {
      const { type, id } = request.params;

      if (!SUPPORTED_TYPES.includes(type as ArtifactType)) {
        return reply.status(400).send({
          error: 'UNKNOWN_TYPE',
          message: `Unknown artifact type '${type}'`,
          supportedTypes: SUPPORTED_TYPES,
        });
      }

      const versions = await storage.listVersions(type as ArtifactType, id);
      return reply.status(200).send({ type, id, versions });
    },
  );

  // ── GET /artifacts/:type/:id/:version/resources/* ──────────────────────────
  // Serves raw resource files embedded in an artifact bundle.
  // The wildcard captures everything after /resources/ (e.g., rules/global-rules.md).
  app.get<{ Params: ResourceParams }>(
    '/artifacts/:type/:id/:version/resources/*',
    async (request, reply) => {
      const { type, id, version } = request.params;
      const resourcePath = request.params['*'];

      if (!SUPPORTED_TYPES.includes(type as ArtifactType)) {
        return reply.status(400).send({
          error: 'UNKNOWN_TYPE',
          message: `Unknown artifact type '${type}'`,
          supportedTypes: SUPPORTED_TYPES,
        });
      }

      // Authorize read
      const decision = auth.authorize(request.serviceUser ?? null, 'read', {
        type,
        id,
        version,
      });
      if (decision === 'deny') {
        return reply.status(403).send({ error: 'FORBIDDEN', message: 'Read access denied' });
      }

      let bundle;
      try {
        bundle = await storage.readBundle(type as ArtifactType, id, version);
      } catch {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Artifact '${type}:${id}@${version}' not found`,
        });
      }

      // Look up the resource file within the bundle
      // The bundle stores files as base64-decoded content; keys are filenames.
      // Resource files are stored under "resources/<path>" in the bundle.
      const resourceKey = `resources/${resourcePath}`;
      const fileContent = bundle.get(resourceKey);

      if (!fileContent) {
        return reply.status(404).send({
          error: 'RESOURCE_NOT_FOUND',
          message: `Resource '${resourcePath}' not found in artifact '${type}:${id}@${version}'`,
        });
      }

      // Serve as plain text
      return reply
        .status(200)
        .header('Content-Type', 'text/plain; charset=utf-8')
        .send(fileContent.toString('utf-8'));
    },
  );
}
