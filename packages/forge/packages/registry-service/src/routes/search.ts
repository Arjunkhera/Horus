/**
 * GET /artifacts?q=<query>&type=<typeId>
 *
 * Public search endpoint — no authentication required.
 * Returns artifacts from the Typesense registry collection.
 *
 * Query params:
 *   q     — search query; empty/absent returns most-recently-published
 *   type  — optional artifact type filter (skill | agent | plugin | persona | workspace-config)
 */

import type { FastifyInstance } from 'fastify';
import type { ArtifactType } from '@forge/core';
import type { RegistrySearchClient } from '../search/registry-search.js';
import { SUPPORTED_TYPES } from '../pipeline/publish-pipeline.js';

interface SearchQuerystring {
  q?: string;
  type?: string;
}

export function registerSearchRoute(
  app: FastifyInstance,
  search: RegistrySearchClient,
): void {
  app.get<{ Querystring: SearchQuerystring }>(
    '/artifacts',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string' },
            type: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { q = '', type } = request.query;

      // Validate type param if provided
      if (type !== undefined && !SUPPORTED_TYPES.includes(type as ArtifactType)) {
        return reply.status(400).send({
          error: 'UNKNOWN_TYPE',
          message: `Unknown artifact type '${type}'`,
          supportedTypes: SUPPORTED_TYPES,
        });
      }

      const results = await search.search(q, type as ArtifactType | undefined);

      return reply.status(200).send({
        query: q,
        total: results.length,
        hits: results,
      });
    },
  );
}
