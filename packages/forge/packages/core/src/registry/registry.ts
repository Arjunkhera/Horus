import { createHash } from 'crypto';
import * as semver from 'semver';
import type { ZodSchema } from 'zod';
import type { DataAdapter } from '../adapters/types.js';
import type {
  ArtifactType,
  ArtifactMeta,
  ArtifactBundle,
  ArtifactRef,
  ArtifactSummary,
  SearchResult,
} from '../models/index.js';
import {
  SkillMetaSchema,
  AgentMetaSchema,
  PluginMetaSchema,
  PersonaMetaSchema,
  WorkspaceConfigMetaSchema,
} from '../models/index.js';
import {
  ArtifactNotFoundError,
  VersionConflictError,
  PublishValidationError,
} from '../adapters/errors.js';

/**
 * Result returned from a successful publish operation.
 */
export interface PublishResult {
  type: ArtifactType;
  id: string;
  version: string;
  registry: string;
  files: Array<{ name: string; sha256: string }>;
}

/**
 * Manifest generated during publish and included in the artifact bundle.
 */
export interface PublishManifest {
  version: string;
  files: Array<{ name: string; sha256: string }>;
  published_at: string;
  publisher: string;
}

/**
 * Map from artifact type to its Zod validation schema.
 */
const META_SCHEMAS: Record<ArtifactType, ZodSchema> = {
  skill: SkillMetaSchema,
  agent: AgentMetaSchema,
  plugin: PluginMetaSchema,
  persona: PersonaMetaSchema,
  'workspace-config': WorkspaceConfigMetaSchema,
};

/**
 * Search/query interface over a DataAdapter.
 * Handles text matching, tag filtering, and result ranking.
 *
 * @example
 * const registry = new Registry(new FilesystemAdapter('./registry'));
 * const results = await registry.search('developer');
 * const skill = await registry.get({ type: 'skill', id: 'developer', version: '1.0.0' });
 */
export class Registry {
  constructor(
    private readonly adapter: DataAdapter,
    private readonly name: string = 'default',
  ) {}

  /**
   * Search for artifacts matching the query.
   * Scores: exact id match (100) > name contains (75) > description contains (50) > tag match (25).
   * Results are sorted by score descending.
   *
   * @param query - Text to search for (case-insensitive substring matching)
   * @param type - Optional artifact type filter
   */
  async search(query: string, type?: ArtifactType): Promise<SearchResult[]> {
    const types: ArtifactType[] = type ? [type] : ['skill', 'agent', 'plugin', 'persona', 'workspace-config'];
    const lowerQuery = query.toLowerCase();
    const results: SearchResult[] = [];

    for (const t of types) {
      const artifacts = await this.adapter.list(t);
      for (const meta of artifacts) {
        const scored = this.score(meta, lowerQuery, t);
        if (scored.score > 0) {
          results.push(scored);
        }
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Get a single artifact bundle by ref.
   * When the ref includes a version suffix (e.g., "id@1.2.0"), the adapter
   * reads that specific version from a versioned directory layout.
   * @throws {ArtifactNotFoundError} if not found
   */
  async get(ref: ArtifactRef): Promise<ArtifactBundle> {
    const exists = await this.adapter.exists(ref.type, ref.id);
    if (!exists) {
      throw new ArtifactNotFoundError(ref.type, ref.id);
    }
    return this.adapter.read(ref.type, ref.id);
  }

  /**
   * List all available semver versions for an artifact.
   * Returns versions sorted descending (highest first).
   * Returns empty array if the adapter doesn't support listVersions
   * or the artifact uses a flat (unversioned) layout.
   */
  async listVersions(type: ArtifactType, id: string): Promise<string[]> {
    if (!this.adapter.listVersions) {
      return [];
    }
    return this.adapter.listVersions(type, id);
  }

  /**
   * List all artifacts, optionally filtered by type.
   * Returns lightweight summaries (no content).
   */
  async list(type?: ArtifactType): Promise<ArtifactSummary[]> {
    const types: ArtifactType[] = type ? [type] : ['skill', 'agent', 'plugin', 'persona', 'workspace-config'];
    const summaries: ArtifactSummary[] = [];

    for (const t of types) {
      const artifacts = await this.adapter.list(t);
      for (const meta of artifacts) {
        summaries.push({
          ref: { type: t, id: meta.id, version: meta.version },
          name: meta.name,
          description: meta.description,
          tags: meta.tags,
        });
      }
    }

    return summaries;
  }

  /**
   * Publish an artifact bundle to the registry.
   *
   * Validates metadata against the appropriate Zod schema, verifies semver,
   * checks for version conflicts, generates a manifest, and writes to the adapter.
   *
   * @returns Structured result with type, id, version, registry name, and file checksums
   * @throws {PublishValidationError} if metadata or semver is invalid
   * @throws {VersionConflictError} if version already exists
   */
  async publish(type: ArtifactType, id: string, bundle: ArtifactBundle): Promise<PublishResult> {
    const { meta, content, contentPath } = bundle;

    // 1. Validate metadata against the appropriate Zod schema
    const schema = META_SCHEMAS[type];
    const parseResult = schema.safeParse(meta);
    if (!parseResult.success) {
      const issues = parseResult.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new PublishValidationError(`Invalid ${type} metadata: ${issues}`);
    }

    // 2. Validate semver
    const version = meta.version;
    if (!semver.valid(version)) {
      throw new PublishValidationError(
        `Invalid semver '${version}'. Must be a valid semantic version (e.g., 1.0.0)`,
      );
    }

    // 3. Check version doesn't already exist
    if (this.adapter.listVersions) {
      const existingVersions = await this.adapter.listVersions(type, id);
      if (existingVersions.includes(version)) {
        throw new VersionConflictError(type, id, version);
      }
    }

    // 4. Generate file checksums for the bundle content
    const files = [
      { name: contentPath, sha256: sha256(content) },
    ];

    // 5. Generate manifest
    const manifest: PublishManifest = {
      version,
      files,
      published_at: new Date().toISOString(),
      publisher: '',
    };

    // 6. Write bundle with manifest included
    // We attach the manifest as a serialized YAML string in a new bundle
    // The adapter receives the original bundle — manifest is written alongside
    const manifestYaml = serializeManifest(manifest);
    const enrichedBundle: ArtifactBundle & { manifest?: string } = {
      ...bundle,
      manifest: manifestYaml,
    };
    await this.adapter.write(type, id, enrichedBundle);

    // 7. Return structured result
    return {
      type,
      id,
      version,
      registry: this.name,
      files,
    };
  }

  private score(
    meta: ArtifactMeta,
    lowerQuery: string,
    type: ArtifactType,
  ): SearchResult {
    let score = 0;
    const matchedOn: SearchResult['matchedOn'] = [];

    if (meta.id === lowerQuery) {
      score += 100;
      matchedOn.push('id');
    } else if (meta.id.includes(lowerQuery)) {
      score += 80;
      matchedOn.push('id');
    }

    if (meta.name.toLowerCase() === lowerQuery) {
      score += 75;
      if (!matchedOn.includes('name')) matchedOn.push('name');
    } else if (meta.name.toLowerCase().includes(lowerQuery)) {
      score += 50;
      if (!matchedOn.includes('name')) matchedOn.push('name');
    }

    if (meta.description.toLowerCase().includes(lowerQuery)) {
      score += 25;
      matchedOn.push('description');
    }

    for (const tag of meta.tags) {
      if (tag.toLowerCase().includes(lowerQuery)) {
        score += 15;
        if (!matchedOn.includes('tags')) matchedOn.push('tags');
        break;
      }
    }

    return {
      ref: { type, id: meta.id, version: meta.version },
      meta,
      score,
      matchedOn,
    };
  }
}

/**
 * Compute SHA-256 hash of a string.
 */
function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Serialize a PublishManifest to YAML-like string format.
 * Uses a simple deterministic format to avoid importing yaml just for this.
 */
function serializeManifest(manifest: PublishManifest): string {
  const lines: string[] = [
    `version: "${manifest.version}"`,
    `published_at: "${manifest.published_at}"`,
    `publisher: "${manifest.publisher}"`,
    'files:',
  ];
  for (const file of manifest.files) {
    lines.push(`  - name: "${file.name}"`);
    lines.push(`    sha256: "${file.sha256}"`);
  }
  return lines.join('\n') + '\n';
}
