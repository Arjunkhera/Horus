/**
 * S3RepoStorageAdapter — S3-backed CRUD for repo metadata.
 *
 * Stores one mutable JSON document per repo at
 *   {prefix}repos/{org}/{name}/metadata.json
 * in the deployed Forge registry's bucket. This makes the repo registry SHARED
 * across environments (ephemeral VMs and user machines), unlike the
 * filesystem/git-backed {@link RepoStorageAdapter} which is machine-local.
 *
 * No application-level versioning: writes overwrite in place. (S3 bucket
 * versioning provides free object-level recovery — not an exposed feature.)
 *
 * The underlying S3 client is constructed from the same S3StorageConfig the
 * artifact backend uses, or injected directly for unit tests (any object with a
 * compatible `send` method).
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { RepoMetadataSchema } from '../types/repo-metadata.js';
import type { RepoMetadata } from '../types/repo-metadata.js';
import type { S3StorageConfig } from '../config.js';
import type { RepoStorage } from './repo-storage.js';

/**
 * Minimal structural type for the S3 client — just the `send` method the
 * adapter relies on. Lets unit tests inject an in-memory fake without pulling
 * in the full AWS SDK client surface.
 */
export interface S3SendClient {
  send(command: unknown): Promise<unknown>;
}

/** Build a real S3Client from config, mirroring the artifact S3 backend. */
function buildS3Client(config: S3StorageConfig): S3Client {
  const clientConfig: S3ClientConfig = { region: config.region };

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
  return new S3Client(clientConfig);
}

/** True when an S3 error represents a missing key (404 / NoSuchKey / NotFound). */
function isNotFound(err: unknown): boolean {
  const code = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    code.name === 'NoSuchKey' ||
    code.name === 'NotFound' ||
    code.$metadata?.httpStatusCode === 404
  );
}

/** Collect an S3 GetObject streaming body into a UTF-8 string. */
async function bodyToString(body: unknown): Promise<string> {
  const chunks: Uint8Array[] = [];
  const stream = body as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class S3RepoStorageAdapter implements RepoStorage {
  private readonly client: S3SendClient;
  private readonly bucket: string;
  private readonly prefix: string;

  /**
   * @param config - The registry's S3 storage config (bucket, region, prefix, creds).
   * @param client - Optional injected S3 client (fake in tests). Defaults to a
   *                 real S3Client built from `config`.
   */
  constructor(config: S3StorageConfig, client?: S3SendClient) {
    this.bucket = config.bucket;
    // Ensure prefix ends with '/' if non-empty (matches artifact backend).
    this.prefix = config.prefix ? config.prefix.replace(/\/?$/, '/') : '';
    this.client = client ?? buildS3Client(config);
  }

  /** S3 object key for a repo's metadata document. */
  private key(org: string, name: string): string {
    return `${this.prefix}repos/${org}/${name}/metadata.json`;
  }

  async write(org: string, name: string, metadata: RepoMetadata): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(org, name),
        Body: Buffer.from(JSON.stringify(metadata, null, 2), 'utf8'),
        ContentType: 'application/json; charset=utf-8',
      }),
    );
  }

  async read(org: string, name: string): Promise<RepoMetadata | null> {
    try {
      const resp = (await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(org, name) }),
      )) as { Body?: unknown };
      if (!resp.Body) return null;
      const content = await bodyToString(resp.Body);
      const parsed: unknown = JSON.parse(content);
      return RepoMetadataSchema.parse(parsed);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(org: string, name: string): Promise<boolean> {
    // DeleteObject is idempotent (no 404), so probe existence first to preserve
    // the "true if it existed" contract the routes rely on for 404 responses.
    if (!(await this.exists(org, name))) return false;
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(org, name) }),
    );
    return true;
  }

  async exists(org: string, name: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(org, name) }),
      );
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async listAll(): Promise<RepoMetadata[]> {
    const results: RepoMetadata[] = [];
    const listPrefix = `${this.prefix}repos/`;
    let continuationToken: string | undefined;

    do {
      const resp = (await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: listPrefix,
          ContinuationToken: continuationToken,
        }),
      )) as {
        Contents?: Array<{ Key?: string }>;
        IsTruncated?: boolean;
        NextContinuationToken?: string;
      };

      for (const obj of resp.Contents ?? []) {
        if (!obj.Key || !obj.Key.endsWith('/metadata.json')) continue;
        try {
          const getResp = (await this.client.send(
            new GetObjectCommand({ Bucket: this.bucket, Key: obj.Key }),
          )) as { Body?: unknown };
          if (!getResp.Body) continue;
          const content = await bodyToString(getResp.Body);
          const parsed: unknown = JSON.parse(content);
          results.push(RepoMetadataSchema.parse(parsed));
        } catch {
          // Skip malformed entries (best-effort, matches filesystem adapter).
        }
      }

      continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (continuationToken);

    return results;
  }
}
