/**
 * POST /artifacts/:type/:id/verify
 *
 * Admin-only endpoint that marks an artifact-id as verified.
 * Verification is at artifact-id level — all existing and future versions
 * automatically inherit the flag.
 *
 * Idempotent: verifying an already-verified artifact returns 200 with
 * { alreadyVerified: true }.
 *
 * Response 200:
 * {
 *   type, id, verified: true, verifiedBy, verifiedAt,
 *   versionsReindexed: number,   // how many Typesense docs were updated
 *   alreadyVerified?: true       // only present when no-op
 * }
 */

import type { FastifyInstance } from 'fastify';
import type { StorageBackend } from '../storage/types.js';
import type { AuditLog } from '../audit/audit-log.js';
import type { AuthStrategy } from '../auth/types.js';
import type { RegistrySearchClient } from '../search/registry-search.js';
import type { ArtifactType } from '@forge/core';
import { SUPPORTED_TYPES } from '../pipeline/publish-pipeline.js';

interface VerifyParams {
  type: string;
  id: string;
}

export function registerVerifyRoute(
  app: FastifyInstance,
  storage: StorageBackend,
  auditLog: AuditLog,
  auth: AuthStrategy,
  search?: RegistrySearchClient,
): void {
  app.post<{ Params: VerifyParams }>(
    '/artifacts/:type/:id/verify',
    {
      schema: {
        params: {
          type: 'object',
          required: ['type', 'id'],
          properties: {
            type: { type: 'string' },
            id: { type: 'string' },
          },
        },
        body: { type: 'object', additionalProperties: true },
      },
    },
    async (request, reply) => {
      const { type, id } = request.params;

      // Validate artifact type
      if (!SUPPORTED_TYPES.includes(type as ArtifactType)) {
        return reply.status(400).send({
          error: 'UNKNOWN_TYPE',
          message: `Unknown artifact type '${type}'`,
          supportedTypes: SUPPORTED_TYPES,
        });
      }

      // Authorize — admin role required
      const decision = auth.authorize(request.serviceUser ?? null, 'verify', {
        type,
        id,
        version: '*',
      });
      if (decision === 'deny') {
        return reply.status(403).send({
          error: 'FORBIDDEN',
          message: 'Admin role required to verify artifacts',
        });
      }

      const artifactType = type as ArtifactType;
      const actorId = request.serviceUser?.userId ?? 'anonymous';
      const now = new Date().toISOString();

      // Idempotency check — if already verified, return 200 no-op
      const alreadyVerified = await storage.isVerified(artifactType, id);
      if (alreadyVerified) {
        return reply.status(200).send({
          type,
          id,
          verified: true,
          alreadyVerified: true,
        });
      }

      // Persist the verification flag at artifact-id level
      await storage.setVerified(artifactType, id, true);

      // Reindex all existing versions in Typesense with verified: true
      let versionsReindexed = 0;
      if (search) {
        try {
          const versions = await storage.listVersions(artifactType, id);
          for (const version of versions) {
            const meta = await storage.getMeta(artifactType, id, version);
            if (!meta) continue;

            await search.indexArtifact(
              {
                id: `${type}:${id}:${version}`,
                type,
                artifact_id: id,
                version,
                // Best-effort rich fields — we don't re-parse metadata.yaml here;
                // the verified flag is what matters for ranking.
                name: id,
                description: '',
                tags: [],
                verified: true,
                publishedAt: Math.floor(meta.publishedAt / 1000),
              },
              app.log,
            );
            versionsReindexed++;
          }
        } catch (err) {
          // Non-fatal — storage write already succeeded
          app.log.warn({ err, type, id }, 'Typesense reindex failed after verify (non-fatal)');
        }
      }

      // Audit log
      await auditLog.append({
        strategy: 'admin',
        actor: actorId,
        action: 'verify',
        resource: `${type}:${id}`,
        decision: 'permit',
        targetType: type,
        targetId: id,
        targetVersion: '*',
        timestamp: now,
      });

      return reply.status(200).send({
        type,
        id,
        verified: true,
        verifiedBy: actorId,
        verifiedAt: now,
        versionsReindexed,
      });
    },
  );
}
