/**
 * S3 StorageBackend implementation.
 *
 * Object key layout:
 *   {prefix}{type}s/{id}/{version}/{filename}
 *
 * e.g., skills/developer/1.0.0/metadata.yaml
 *
 * Security note: S3 credentials NEVER appear in responses, logs, or audit entries.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import * as semver from 'semver';
import type { ArtifactType } from '@forge/core';
import type { StorageBackend, StoredVersionMeta, BundleFiles, StoredBundle, ArtifactIndexMeta } from './types.js';
import type { S3StorageConfig } from '../config.js';

/**
 * Converts a Buffer or string to a Buffer.
 */
function toBuffer(val: Buffer | string): Buffer {
  return Buffer.isBuffer(val) ? val : Buffer.from(val, 'utf8');
}

/**
 * Converts an ArtifactType to its plural key segment.
 * e.g., 'skill' → 'skills', 'workspace-config' → 'workspace-configs'
 */
function typeSegment(type: ArtifactType): string {
  return `${type}s`;
}

export class S3StorageBackend implements StorageBackend {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(config: S3StorageConfig) {
    const clientConfig: S3ClientConfig = {
      region: config.region,
    };

    // Credentials — only inject if present (some envs use instance roles)
    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }

    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
      clientConfig.forcePathStyle = config.forcePathStyle;
    }

    this.client = new S3Client(clientConfig);
    this.bucket = config.bucket;
    // Ensure prefix ends with '/' if non-empty
    this.prefix = config.prefix ? config.prefix.replace(/\/?$/, '/') : '';
  }

  /**
   * Build the S3 key for a specific file within an artifact version.
   */
  private key(type: ArtifactType, id: string, version: string, filename: string): string {
    return `${this.prefix}${typeSegment(type)}/${id}/${version}/${filename}`;
  }

  /**
   * Build the key prefix that covers all files for a version.
   */
  private versionPrefix(type: ArtifactType, id: string, version: string): string {
    return `${this.prefix}${typeSegment(type)}/${id}/${version}/`;
  }

  async ping(): Promise<boolean> {
    // HEAD the bucket to verify connectivity and permissions
    try {
      await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }),
      );
      return true;
    } catch (err) {
      throw new Error(
        `S3 backend unavailable (bucket: ${this.bucket}): ${(err as Error).message}`,
      );
    }
  }

  async exists(type: ArtifactType, id: string, version: string): Promise<boolean> {
    // We use manifest.yaml as the canonical existence marker
    const manifestKey = this.key(type, id, version, 'manifest.yaml');
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: manifestKey }),
      );
      return true;
    } catch (err: unknown) {
      const code = (err as { name?: string; $metadata?: { httpStatusCode?: number } });
      if (
        code.name === 'NotFound' ||
        code.name === 'NoSuchKey' ||
        code.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      throw err;
    }
  }

  async getMeta(
    type: ArtifactType,
    id: string,
    version: string,
  ): Promise<StoredVersionMeta | null> {
    const manifestKey = this.key(type, id, version, 'manifest.yaml');
    try {
      const resp = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: manifestKey }),
      );
      const publishedAt = resp.LastModified?.getTime() ?? Date.now();

      // Checksums are stored in S3 object metadata as x-amz-meta-checksums (json)
      const checksumsMeta = resp.Metadata?.['checksums'];
      const checksums: Record<string, string> = checksumsMeta
        ? (JSON.parse(checksumsMeta) as Record<string, string>)
        : {};

      return { type, id, version, publishedAt, checksums };
    } catch (err: unknown) {
      const code = (err as { name?: string; $metadata?: { httpStatusCode?: number } });
      if (
        code.name === 'NotFound' ||
        code.name === 'NoSuchKey' ||
        code.$metadata?.httpStatusCode === 404
      ) {
        return null;
      }
      throw err;
    }
  }

  async writeBundle(
    type: ArtifactType,
    id: string,
    version: string,
    files: BundleFiles,
  ): Promise<void> {
    // S3 doesn't support true atomic multi-object writes; we upload all files
    // then finally upload manifest.yaml as the "commit marker". Readers check
    // for manifest.yaml existence before serving a version.

    // Compute checksums map for storage in S3 metadata
    const checksums: Record<string, string> = {};
    for (const [filename, content] of files) {
      if (filename === 'manifest.yaml') continue; // manifest carries its own checksums
      const buf = toBuffer(content);
      const { createHash } = await import('node:crypto');
      checksums[filename] = createHash('sha256').update(buf).digest('hex');
    }
    const checksumsJson = JSON.stringify(checksums);

    // Upload all non-manifest files first
    const uploads: Promise<void>[] = [];
    for (const [filename, content] of files) {
      if (filename === 'manifest.yaml') continue;
      const key = this.key(type, id, version, filename);
      const buf = toBuffer(content);
      uploads.push(
        this.client
          .send(
            new PutObjectCommand({
              Bucket: this.bucket,
              Key: key,
              Body: buf,
              ContentType: 'text/plain; charset=utf-8',
            }),
          )
          .then(() => undefined),
      );
    }
    await Promise.all(uploads);

    // Upload manifest last (commit marker) with checksums in metadata
    const manifestContent = files.get('manifest.yaml');
    if (manifestContent === undefined) {
      throw new Error('BundleFiles must include manifest.yaml');
    }
    const manifestKey = this.key(type, id, version, 'manifest.yaml');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: manifestKey,
        Body: toBuffer(manifestContent),
        ContentType: 'text/yaml; charset=utf-8',
        Metadata: { checksums: checksumsJson },
      }),
    );
  }

  async readBundle(type: ArtifactType, id: string, version: string): Promise<StoredBundle> {
    const prefix = this.versionPrefix(type, id, version);

    // List all objects under the version prefix
    const listResp = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix }),
    );

    if (!listResp.Contents || listResp.Contents.length === 0) {
      throw new Error(`Artifact ${type}:${id}@${version} not found in storage`);
    }

    const bundle: StoredBundle = new Map();
    const fetches = listResp.Contents.map(async (obj) => {
      if (!obj.Key) return;
      const filename = obj.Key.slice(prefix.length);
      if (!filename) return;

      const getResp = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: obj.Key }),
      );
      if (!getResp.Body) return;

      // Collect streaming body into Buffer
      const chunks: Uint8Array[] = [];
      const stream = getResp.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      bundle.set(filename, Buffer.concat(chunks));
    });

    await Promise.all(fetches);
    return bundle;
  }

  async listVersions(type: ArtifactType, id: string): Promise<string[]> {
    const prefix = `${this.prefix}${typeSegment(type)}/${id}/`;
    const resp = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        Delimiter: '/',
      }),
    );

    const versions: string[] = [];
    for (const cp of resp.CommonPrefixes ?? []) {
      if (!cp.Prefix) continue;
      const segment = cp.Prefix.slice(prefix.length).replace(/\/$/, '');
      if (semver.valid(segment)) {
        versions.push(segment);
      }
    }

    return versions.sort((a, b) => semver.rcompare(a, b));
  }

  /**
   * List metadata for every stored artifact version across all supported types.
   *
   * Strategy:
   *   1. For each known type, list all artifact IDs using delimiter-based listing.
   *   2. For each artifact ID, list all versions.
   *   3. For each version, fetch getMeta() + attempt to read metadata.yaml for
   *      name/description/tags/verified fields.
   *
   * This is an expensive operation and is only called during cold rebuild.
   */
  async listAll(): Promise<ArtifactIndexMeta[]> {
    const { parse: parseYaml } = await import('yaml');
    const TYPES: ArtifactType[] = ['skill', 'agent', 'plugin', 'persona', 'workspace-config'];
    const results: ArtifactIndexMeta[] = [];

    for (const type of TYPES) {
      // List all artifact IDs for this type
      const typePrefix = `${this.prefix}${typeSegment(type)}/`;
      const listResp = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: typePrefix,
          Delimiter: '/',
        }),
      );

      for (const cp of listResp.CommonPrefixes ?? []) {
        if (!cp.Prefix) continue;
        const artifactId = cp.Prefix.slice(typePrefix.length).replace(/\/$/, '');
        if (!artifactId) continue;

        const versions = await this.listVersions(type, artifactId);
        for (const version of versions) {
          const meta = await this.getMeta(type, artifactId, version);
          if (!meta) continue;

          const entry: ArtifactIndexMeta = {
            type,
            id: artifactId,
            version,
            publishedAt: meta.publishedAt,
          };

          // Best-effort: read metadata.yaml for rich fields
          try {
            const metaKey = this.key(type, artifactId, version, 'metadata.yaml');
            const getResp = await this.client.send(
              new GetObjectCommand({ Bucket: this.bucket, Key: metaKey }),
            );
            if (getResp.Body) {
              const chunks: Uint8Array[] = [];
              const stream = getResp.Body as AsyncIterable<Uint8Array>;
              for await (const chunk of stream) {
                chunks.push(chunk);
              }
              const content = Buffer.concat(chunks).toString('utf8');
              const parsed = parseYaml(content) as Record<string, unknown>;
              if (typeof parsed['name'] === 'string') entry.name = parsed['name'];
              if (typeof parsed['description'] === 'string') entry.description = parsed['description'];
              if (Array.isArray(parsed['tags'])) entry.tags = parsed['tags'] as string[];
              if (typeof parsed['verified'] === 'boolean') entry.verified = parsed['verified'];
            }
          } catch {
            // Best-effort — missing metadata.yaml is fine, we just won't have rich fields
          }

          results.push(entry);
        }
      }
    }

    return results;
  }
}
