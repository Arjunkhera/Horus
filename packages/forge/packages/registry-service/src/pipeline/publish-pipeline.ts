/**
 * Publish pipeline.
 *
 * Steps (in order):
 *   1. Validate artifact type is known
 *   2. Check X-Forge-Core-Version header compatibility
 *   3. Authorize the caller (admin role required)
 *   4. Parse + validate metadata against the type's Zod schema
 *   5. Enforce immutability (reject re-publish of existing version)
 *   6. Compute SHA-256 checksums per file
 *   7. Generate manifest.yaml
 *   8. Write bundle atomically to storage
 *   9. Append audit log entry
 *  10. Return 201 result
 */

import { createHash } from 'node:crypto';
import * as semver from 'semver';
import { stringify as yamlStringify } from 'yaml';
import type { ArtifactType } from '@forge/core';
import {
  SkillMetaSchema,
  AgentMetaSchema,
  PluginMetaSchema,
  PersonaMetaSchema,
  WorkspaceConfigMetaSchema,
  type ArtifactReference,
} from '@forge/core';
import type { ZodSchema } from 'zod';
import type { StorageBackend, BundleFiles } from '../storage/types.js';
import type { AuditLog } from '../audit/audit-log.js';
import type { AuthStrategy } from '../auth/types.js';
import type { ServiceUser } from '../types.js';
import type { RegistrySearchClient, ArtifactDocument } from '../search/registry-search.js';

// ---------------------------------------------------------------------------
// Supported types registry (mirrors @forge/core META_SCHEMAS)
// ---------------------------------------------------------------------------

export const SUPPORTED_TYPES: ArtifactType[] = [
  'skill',
  'agent',
  'plugin',
  'persona',
  'workspace-config',
];

// ---------------------------------------------------------------------------
// Cross-artifact reference rules
// ---------------------------------------------------------------------------

/**
 * Which artifact types each artifact type is allowed to reference.
 * Empty array means the type cannot reference any other artifacts.
 */
export const ALLOWED_REFERENCE_TARGETS: Record<ArtifactType, ArtifactType[]> = {
  skill: [],
  agent: ['skill'],
  plugin: ['skill'],
  persona: [],
  'workspace-config': ['plugin', 'skill'],
};

const META_SCHEMAS: Record<ArtifactType, ZodSchema> = {
  skill: SkillMetaSchema,
  agent: AgentMetaSchema,
  plugin: PluginMetaSchema,
  persona: PersonaMetaSchema,
  'workspace-config': WorkspaceConfigMetaSchema,
};

// ---------------------------------------------------------------------------
// Pipeline input / output
// ---------------------------------------------------------------------------

/**
 * Raw incoming publish request data — already parsed from HTTP body.
 */
export interface PublishInput {
  /** Artifact type from URL param */
  type: string;
  /** Artifact id from URL param */
  id: string;
  /** Version from URL param */
  version: string;
  /**
   * Map of filename → raw content.
   * Must include at least 'metadata.yaml' and a content file.
   */
  files: Map<string, Buffer | string>;
  /** Value of X-Forge-Core-Version header */
  coreVersionHeader: string | undefined;
  /** Resolved caller (may be null for anonymous) */
  caller: ServiceUser | null;
}

export interface FileChecksum {
  name: string;
  sha256: string;
}

export interface PublishOutput {
  type: ArtifactType;
  id: string;
  version: string;
  publishedAt: string;
  files: FileChecksum[];
  manifest: string;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class PipelineError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class PublishPipeline {
  constructor(
    private readonly storage: StorageBackend,
    private readonly auditLog: AuditLog,
    private readonly auth: AuthStrategy,
    private readonly serviceVersion: string,
    private readonly search?: RegistrySearchClient,
    /** Logger for surfacing best-effort search-index failures at publish time. */
    private readonly logger?: { warn: (obj: unknown, msg: string) => void },
    /** Name of the active auth strategy — threaded into every audit entry */
    private readonly strategyName: string = 'builtin',
  ) {}

  async run(input: PublishInput): Promise<PublishOutput> {
    // ── Step 1: Validate artifact type ──────────────────────────────────────
    if (!SUPPORTED_TYPES.includes(input.type as ArtifactType)) {
      throw new PipelineError(400, 'UNKNOWN_TYPE', `Unknown artifact type '${input.type}'`, {
        supportedTypes: SUPPORTED_TYPES,
      });
    }
    const type = input.type as ArtifactType;

    // ── Step 2: Core version compatibility ──────────────────────────────────
    if (input.coreVersionHeader !== undefined) {
      const clientVersion = input.coreVersionHeader.trim();
      if (!semver.valid(clientVersion)) {
        throw new PipelineError(
          400,
          'INVALID_CORE_VERSION',
          `X-Forge-Core-Version '${clientVersion}' is not a valid semver string`,
        );
      }
      const serviceMajor = semver.major(this.serviceVersion);
      const clientMajor = semver.major(clientVersion);
      if (clientMajor !== serviceMajor) {
        // Major version mismatch → incompatible
        const status = semver.gt(clientVersion, this.serviceVersion) ? 426 : 409;
        throw new PipelineError(
          status,
          'CORE_VERSION_INCOMPATIBLE',
          `Client forge-core ${clientVersion} is incompatible with registry core ${this.serviceVersion}`,
          { serviceVersion: this.serviceVersion, clientVersion },
        );
      }
    }

    // ── Step 3: Authorize ────────────────────────────────────────────────────
    const decision = this.auth.authorize(input.caller, 'publish', {
      type,
      id: input.id,
      version: input.version,
    });
    if (decision === 'deny') {
      throw new PipelineError(
        403,
        'FORBIDDEN',
        'You do not have permission to publish artifacts',
      );
    }

    // ── Step 4: Validate metadata ────────────────────────────────────────────
    const metadataContent = input.files.get('metadata.yaml');
    if (metadataContent === undefined) {
      throw new PipelineError(400, 'MISSING_METADATA', 'Bundle must include metadata.yaml');
    }

    let parsedMeta: unknown;
    try {
      const { parse: parseYaml } = await import('yaml');
      const raw =
        typeof metadataContent === 'string'
          ? metadataContent
          : metadataContent.toString('utf8');
      parsedMeta = parseYaml(raw);
    } catch (err) {
      throw new PipelineError(
        400,
        'INVALID_METADATA_YAML',
        `metadata.yaml is not valid YAML: ${(err as Error).message}`,
      );
    }

    const schema = META_SCHEMAS[type];
    const parseResult = schema.safeParse(parsedMeta);
    if (!parseResult.success) {
      const issues = parseResult.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new PipelineError(400, 'SCHEMA_VALIDATION_FAILED', `Invalid ${type} metadata: ${issues}`, {
        issues: parseResult.error.issues,
      });
    }

    const meta = parseResult.data as { id: string; version: string; references?: ArtifactReference[] };

    // Ensure URL params match metadata
    if (meta.id !== input.id) {
      throw new PipelineError(
        400,
        'ID_MISMATCH',
        `URL id '${input.id}' does not match metadata.yaml id '${meta.id}'`,
      );
    }
    if (meta.version !== input.version) {
      throw new PipelineError(
        400,
        'VERSION_MISMATCH',
        `URL version '${input.version}' does not match metadata.yaml version '${meta.version}'`,
      );
    }
    if (!semver.valid(input.version)) {
      throw new PipelineError(
        400,
        'INVALID_SEMVER',
        `Version '${input.version}' is not a valid semver string`,
      );
    }

    // ── Step 4b: Validate references ─────────────────────────────────────────
    if (meta.references && meta.references.length > 0) {
      const allowedTargets = ALLOWED_REFERENCE_TARGETS[type];
      for (const ref of meta.references) {
        // Check that the reference type is allowed for this artifact type
        if (!allowedTargets.includes(ref.type as ArtifactType)) {
          throw new PipelineError(
            400,
            'DISALLOWED_REFERENCE_TYPE',
            `Artifact type '${type}' cannot reference '${ref.type}'`,
            { supportedTargets: allowedTargets },
          );
        }
        // Check that the referenced artifact exists in storage
        const refExists = await this.storage.exists(ref.type as ArtifactType, ref.id, ref.version);
        if (!refExists) {
          throw new PipelineError(
            400,
            'REFERENCE_NOT_FOUND',
            `Referenced artifact '${ref.type}:${ref.id}@${ref.version}' does not exist`,
            { missingRef: { type: ref.type, id: ref.id, version: ref.version } },
          );
        }
      }
    }

    // ── Step 5: Immutability check ───────────────────────────────────────────
    const alreadyExists = await this.storage.exists(type, input.id, input.version);
    if (alreadyExists) {
      throw new PipelineError(
        409,
        'VERSION_CONFLICT',
        `Version '${input.version}' of '${type}:${input.id}' already exists and cannot be overwritten`,
      );
    }

    // ── Step 6: Compute SHA-256 checksums ────────────────────────────────────
    const fileChecksums: FileChecksum[] = [];
    for (const [filename, content] of input.files) {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
      const hash = createHash('sha256').update(buf).digest('hex');
      fileChecksums.push({ name: filename, sha256: hash });
    }

    // ── Step 7: Generate manifest.yaml ───────────────────────────────────────
    const publishedAt = new Date().toISOString();
    const actorId = input.caller?.userId ?? 'anonymous';

    const manifestData = {
      version: input.version,
      published_at: publishedAt,
      publisher: actorId,
      files: fileChecksums.map((f) => ({ name: f.name, sha256: f.sha256 })),
    };
    const manifestYaml = yamlStringify(manifestData, { lineWidth: 0 });

    // ── Step 8: Write bundle atomically ──────────────────────────────────────
    const bundleFiles: BundleFiles = new Map(input.files);
    bundleFiles.set('manifest.yaml', manifestYaml);

    try {
      await this.storage.writeBundle(type, input.id, input.version, bundleFiles);
    } catch (err) {
      // Map storage-level concurrent-write rejection (ECONFLICT) to 409
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ECONFLICT') {
        throw new PipelineError(
          409,
          'PUBLISH_CONFLICT',
          `A publish is already in progress — please retry after the current publish completes`,
        );
      }
      throw err;
    }

    // ── Step 9: Audit log ─────────────────────────────────────────────────────
    await this.auditLog.append({
      strategy: this.strategyName,
      actor: actorId,
      action: 'publish',
      resource: `${type}:${input.id}@${input.version}`,
      decision: 'permit',
      targetType: type,
      targetId: input.id,
      targetVersion: input.version,
      timestamp: publishedAt,
    });

    // ── Step 9.5: Search indexing (best-effort) ───────────────────────────────
    if (this.search) {
      const richMeta = meta as {
        id: string;
        version: string;
        name?: string;
        description?: string;
        tags?: string[];
        verified?: boolean;
      };

      // Inherit artifact-id-level verified flag: if the artifact-id has been
      // previously verified, new versions automatically inherit verified: true.
      let inheritedVerified = richMeta.verified ?? false;
      if (!inheritedVerified) {
        try {
          inheritedVerified = await this.storage.isVerified(type, input.id);
        } catch {
          // Best-effort — don't fail publish if verification check fails
        }
      }

      const doc: ArtifactDocument = {
        id: `${type}:${input.id}:${input.version}`,
        type,
        artifact_id: input.id,
        version: input.version,
        name: richMeta.name ?? input.id,
        description: richMeta.description ?? '',
        tags: richMeta.tags ?? [],
        verified: inheritedVerified,
        publishedAt: Math.floor(new Date(publishedAt).getTime() / 1000),
      };

      // Index synchronously (awaited) so the attempt isn't lost to a detached
      // promise if the process exits right after publish. indexArtifact catches
      // and logs internally via the passed logger; the outer catch keeps publish
      // resilient if indexing throws. A partial index is also self-healed on the
      // next restart by RegistrySearchClient.rebuild()'s storage-count reconcile.
      await this.search.indexArtifact(doc, this.logger).catch(() => {
        // Typesense unavailable — publish still succeeds (failure already logged)
      });
    }

    // ── Step 10: Return result ────────────────────────────────────────────────
    return {
      type,
      id: input.id,
      version: input.version,
      publishedAt,
      files: fileChecksums,
      manifest: manifestYaml,
    };
  }
}
