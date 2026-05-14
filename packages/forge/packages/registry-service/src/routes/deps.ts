/**
 * GET /artifacts/:type/:id/:version/deps
 *
 * Returns the full transitive dependency tree for an artifact, walking
 * the `references` field recursively. Circular dependencies are detected
 * and reported as a 409 error.
 *
 * No authentication required (public read).
 */

import type { FastifyInstance } from 'fastify';
import type { StorageBackend } from '../storage/types.js';
import type { ArtifactType } from '@forge/core';
import { SUPPORTED_TYPES } from '../pipeline/publish-pipeline.js';
import { parse as parseYaml } from 'yaml';

interface ArtifactParams {
  type: string;
  id: string;
  version: string;
}

export interface DepNode {
  type: ArtifactType;
  id: string;
  version: string;
  /** verified is false in phase 1a.6; 1d will add verification state */
  verified: boolean;
  deps: DepNode[];
}

interface RawReference {
  type: string;
  id: string;
  version: string;
}

/**
 * Read and parse the metadata.yaml for an artifact, returning its `references` array.
 * Returns an empty array if the artifact has no references or the metadata cannot be parsed.
 */
async function getReferences(
  storage: StorageBackend,
  type: ArtifactType,
  id: string,
  version: string,
): Promise<RawReference[]> {
  let bundle;
  try {
    bundle = await storage.readBundle(type, id, version);
  } catch {
    return [];
  }

  const metadataFile = bundle.get('metadata.yaml');
  if (!metadataFile) return [];

  let parsed: unknown;
  try {
    parsed = parseYaml(metadataFile.toString('utf8'));
  } catch {
    return [];
  }

  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'references' in parsed &&
    Array.isArray((parsed as Record<string, unknown>).references)
  ) {
    return (parsed as { references: RawReference[] }).references;
  }

  return [];
}

/**
 * Recursively walk references, building the dep tree.
 * `visiting` is the current DFS path (for cycle detection).
 * `visited` is a cache of already-built subtrees (for deduplication).
 */
async function buildDepTree(
  storage: StorageBackend,
  type: ArtifactType,
  id: string,
  version: string,
  visiting: Set<string>,
  visited: Map<string, DepNode>,
): Promise<DepNode> {
  const key = `${type}:${id}@${version}`;

  if (visiting.has(key)) {
    throw new Error(`Circular dependency detected: ${key}`);
  }

  if (visited.has(key)) {
    return visited.get(key)!;
  }

  visiting.add(key);

  const references = await getReferences(storage, type, id, version);
  const depChildren: DepNode[] = [];

  for (const ref of references) {
    const child = await buildDepTree(
      storage,
      ref.type as ArtifactType,
      ref.id,
      ref.version,
      visiting,
      visited,
    );
    depChildren.push(child);
  }

  visiting.delete(key);

  const node: DepNode = {
    type,
    id,
    version,
    verified: false,
    deps: depChildren,
  };

  visited.set(key, node);
  return node;
}

export function registerDepsRoute(app: FastifyInstance, storage: StorageBackend): void {
  app.get<{ Params: ArtifactParams }>(
    '/artifacts/:type/:id/:version/deps',
    async (request, reply) => {
      const { type, id, version } = request.params;

      if (!SUPPORTED_TYPES.includes(type as ArtifactType)) {
        return reply.status(400).send({
          error: 'UNKNOWN_TYPE',
          message: `Unknown artifact type '${type}'`,
          supportedTypes: SUPPORTED_TYPES,
        });
      }

      // Verify the artifact itself exists
      const exists = await storage.exists(type as ArtifactType, id, version);
      if (!exists) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Artifact '${type}:${id}@${version}' not found`,
        });
      }

      const visiting = new Set<string>();
      const visited = new Map<string, DepNode>();

      let tree: DepNode;
      try {
        tree = await buildDepTree(
          storage,
          type as ArtifactType,
          id,
          version,
          visiting,
          visited,
        );
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Circular dependency detected')) {
          return reply.status(409).send({
            error: 'CIRCULAR_DEPENDENCY',
            message: err.message,
          });
        }
        throw err;
      }

      return reply.status(200).send(tree);
    },
  );
}
