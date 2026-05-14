/**
 * POST /artifacts/:type/:id/:version
 *
 * Accepts a multipart or JSON artifact bundle.
 *
 * Request body (JSON):
 * {
 *   files: { [filename: string]: string }  // filename → base64-encoded content
 * }
 *
 * Response 201:
 * {
 *   type, id, version, publishedAt,
 *   files: [{ name, sha256 }],
 *   manifest: "<yaml string>"
 * }
 */

import type { FastifyInstance } from 'fastify';
import type { PublishPipeline } from '../pipeline/publish-pipeline.js';
import { PipelineError } from '../pipeline/publish-pipeline.js';

interface PublishParams {
  type: string;
  id: string;
  version: string;
}

interface PublishBody {
  /** filename → base64-encoded file content */
  files?: Record<string, string>;
}

export function registerPublishRoute(
  app: FastifyInstance,
  pipeline: PublishPipeline,
): void {
  app.post<{ Params: PublishParams; Body: PublishBody }>(
    '/artifacts/:type/:id/:version',
    {
      schema: {
        params: {
          type: 'object',
          required: ['type', 'id', 'version'],
          properties: {
            type: { type: 'string' },
            id: { type: 'string' },
            version: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { type, id, version } = request.params;

      // Decode files map
      const rawFiles = request.body?.files ?? {};
      const files = new Map<string, Buffer>();
      for (const [filename, b64] of Object.entries(rawFiles)) {
        files.set(filename, Buffer.from(b64, 'base64'));
      }

      try {
        const result = await pipeline.run({
          type,
          id,
          version,
          files,
          coreVersionHeader: request.headers['x-forge-core-version'] as string | undefined,
          caller: request.serviceUser ?? null,
        });

        return reply.status(201).send(result);
      } catch (err) {
        if (err instanceof PipelineError) {
          return reply.status(err.httpStatus).send({
            error: err.code,
            message: err.message,
            ...(err.extra ?? {}),
          });
        }
        // Unexpected error — let Fastify's default error handler log + respond
        throw err;
      }
    },
  );
}
