/**
 * POST /artifacts/:type/:id/:version/unverify
 *
 * Marks a specific artifact version as NOT verified, regardless of the
 * artifact-id-level verified flag. This is a per-version revocation endpoint.
 *
 * Use case: a single compromised release can be revoked without invalidating
 * trust in the rest of the artifact's history.
 *
 * Authorization: admin role required.
 * Idempotent: re-unverifying returns 200 with a no-op indicator.
 * No inverse endpoint in V1 (no re-verify-single-version).
 */

import type { FastifyInstance } from 'fastify';
import type { StorageBackend } from '../storage/types.js';
import type { AuditLog } from '../audit/audit-log.js';
import type { AuthStrategy } from '../auth/types.js';
import type { RegistrySearchClient } from '../search/registry-search.js';
import type { ArtifactType } from '@forge/core';
import { SUPPORTED_TYPES } from '../pipeline/publish-pipeline.js';

interface ArtifactParams {
  type: string;
  id: string;
  version: string;
}

interface UnverifyBody {
  reason?: string;
}

export function registerUnverifyRoute(
  app: FastifyInstance,
  storage: StorageBackend,
  auditLog: AuditLog,
  auth: AuthStrategy,
  search?: RegistrySearchClient,
): void {
  app.post<{ Params: ArtifactParams; Body: UnverifyBody }>(
    '/artifacts/:type/:id/:version/unverify',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            reason: { type: 'string' },
          },
          additionalProperties: false,
          nullable: true,
        },
      },
    },
    async (request, reply) => {
      const { type, id, version } = request.params;
      const { reason } = request.body ?? {};

      // Validate artifact type
      if (!SUPPORTED_TYPES.includes(type as ArtifactType)) {
        return reply.status(400).send({
          error: 'UNKNOWN_TYPE',
          message: `Unknown artifact type '${type}'`,
          supportedTypes: SUPPORTED_TYPES,
        });
      }

      // Authorize — admin only
      const decision = auth.authorize(request.serviceUser ?? null, 'unverify', {
        type,
        id,
        version,
      });
      if (decision === 'deny') {
        return reply.status(403).send({
          error: 'FORBIDDEN',
          message: 'Admin role required to revoke version verification',
        });
      }

      // Verify the artifact version actually exists
      const exists = await storage.exists(type as ArtifactType, id, version);
      if (!exists) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Artifact '${type}:${id}@${version}' not found`,
        });
      }

      // Idempotency check — if already unverified, return 200 no-op
      const alreadyUnverified = await storage.isVersionUnverified(type as ArtifactType, id, version);
      if (alreadyUnverified) {
        return reply.status(200).send({
          type,
          id,
          version,
          verified: false,
          noOp: true,
          message: 'Version was already unverified',
        });
      }

      // Write the override
      const actorId = request.serviceUser!.userId;
      await storage.setVersionUnverified(
        type as ArtifactType,
        id,
        version,
        actorId,
        reason,
      );

      // Patch verified: false on the existing Typesense document for this version.
      // Uses a partial update (PATCH) so other fields (name, description, tags, etc.) are preserved.
      if (search) {
        await search.setDocumentVerified(type, id, version, false, app.log);
      }

      // Append audit log entry
      await auditLog.append({
        strategy: 'admin',
        actor: actorId,
        action: 'unverify',
        resource: `${type}:${id}@${version}`,
        decision: 'permit',
        targetType: type,
        targetId: id,
        targetVersion: version,
        timestamp: new Date().toISOString(),
        meta: reason ? JSON.stringify({ reason }) : undefined,
      });

      return reply.status(200).send({
        type,
        id,
        version,
        verified: false,
        noOp: false,
        message: 'Version verification revoked',
      });
    },
  );
}
