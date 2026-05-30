/**
 * Tests for S3RepoStorageAdapter using an in-memory fake S3 client.
 *
 * The fake implements just `send(command)`, discriminating on the AWS SDK
 * command class name — the same surface the real S3Client exposes. This keeps
 * the adapter honest about object keys, prefixing, and 404 handling without
 * touching the network.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { S3RepoStorageAdapter, type S3SendClient } from '../src/storage/repo-storage-s3.js';
import type { S3StorageConfig } from '../src/config.js';
import type { RepoMetadata } from '../src/types/repo-metadata.js';

// ---------------------------------------------------------------------------
// Fake S3 client — in-memory object store keyed by S3 object key.
// ---------------------------------------------------------------------------

class NotFoundError extends Error {
  name = 'NotFound';
  $metadata = { httpStatusCode: 404 };
}

class FakeS3Client implements S3SendClient {
  /** key → stored UTF-8 body */
  readonly objects = new Map<string, string>();

  async send(command: unknown): Promise<unknown> {
    const name = (command as { constructor: { name: string } }).constructor.name;
    const input = (command as { input: Record<string, unknown> }).input;

    switch (name) {
      case 'PutObjectCommand': {
        const body = input['Body'] as Buffer | string;
        this.objects.set(
          input['Key'] as string,
          Buffer.isBuffer(body) ? body.toString('utf8') : String(body),
        );
        return {};
      }
      case 'GetObjectCommand': {
        const key = input['Key'] as string;
        if (!this.objects.has(key)) throw new NotFoundError(`no such key: ${key}`);
        const content = this.objects.get(key)!;
        // Return an async-iterable Body, like the real streaming response.
        return {
          Body: (async function* () {
            yield Buffer.from(content, 'utf8');
          })(),
        };
      }
      case 'HeadObjectCommand': {
        const key = input['Key'] as string;
        if (!this.objects.has(key)) throw new NotFoundError(`no such key: ${key}`);
        return {};
      }
      case 'DeleteObjectCommand': {
        this.objects.delete(input['Key'] as string);
        return {};
      }
      case 'ListObjectsV2Command': {
        const prefix = (input['Prefix'] as string) ?? '';
        const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix));
        return { Contents: keys.map((Key) => ({ Key })), IsTruncated: false };
      }
      default:
        throw new Error(`FakeS3Client: unhandled command ${name}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<S3StorageConfig> = {}): S3StorageConfig {
  return {
    backend: 's3',
    bucket: 'horus-forge-registry',
    region: 'us-east-1',
    prefix: '',
    forcePathStyle: false,
    ...overrides,
  };
}

function makeMetadata(overrides: Partial<RepoMetadata> = {}): RepoMetadata {
  return {
    org: 'acme',
    name: 'my-repo',
    canonicalUrl: 'git@github.com:acme/my-repo.git',
    registeredAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('S3RepoStorageAdapter', () => {
  let fake: FakeS3Client;
  let adapter: S3RepoStorageAdapter;

  beforeEach(() => {
    fake = new FakeS3Client();
    adapter = new S3RepoStorageAdapter(makeConfig(), fake);
  });

  it('write stores metadata at repos/{org}/{name}/metadata.json', async () => {
    await adapter.write('acme', 'my-repo', makeMetadata());
    expect(fake.objects.has('repos/acme/my-repo/metadata.json')).toBe(true);
  });

  it('write honors the configured prefix', async () => {
    const prefixed = new S3RepoStorageAdapter(makeConfig({ prefix: 'forge' }), fake);
    await prefixed.write('acme', 'my-repo', makeMetadata());
    expect(fake.objects.has('forge/repos/acme/my-repo/metadata.json')).toBe(true);
  });

  it('write + read roundtrip preserves all fields', async () => {
    const metadata = makeMetadata({
      description: 'Test repository',
      topics: ['typescript', 'testing'],
      language: 'TypeScript',
      defaultBranch: 'main',
      host: { url: 'https://github.com', provider: 'github' },
      credential: { type: 'gh-cli', label: 'gh' },
      workflow: {
        type: 'owner',
        pushTo: 'origin',
        prTarget: { repo: 'acme/my-repo', branch: 'main' },
        mergeStrategy: 'squash',
      },
      vaultScope: { repo: 'horus', program: 'forge-v3' },
      extra: { custom: true },
    });

    await adapter.write('acme', 'my-repo', metadata);
    const result = await adapter.read('acme', 'my-repo');

    expect(result).not.toBeNull();
    expect(result).toEqual(metadata);
  });

  it('write to existing org/name overwrites in place (no versioning)', async () => {
    await adapter.write('acme', 'my-repo', makeMetadata({ description: 'First' }));
    await adapter.write(
      'acme',
      'my-repo',
      makeMetadata({ description: 'Second', updatedAt: '2024-02-01T00:00:00.000Z' }),
    );
    const result = await adapter.read('acme', 'my-repo');
    expect(result?.description).toBe('Second');
    expect(fake.objects.size).toBe(1);
  });

  it('read returns null for missing repo', async () => {
    expect(await adapter.read('acme', 'nonexistent')).toBeNull();
  });

  it('exists returns true after write, false otherwise', async () => {
    await adapter.write('acme', 'my-repo', makeMetadata());
    expect(await adapter.exists('acme', 'my-repo')).toBe(true);
    expect(await adapter.exists('acme', 'nope')).toBe(false);
  });

  it('delete returns true when the repo existed and removes it', async () => {
    await adapter.write('acme', 'my-repo', makeMetadata());
    expect(await adapter.delete('acme', 'my-repo')).toBe(true);
    expect(await adapter.read('acme', 'my-repo')).toBeNull();
  });

  it('delete returns false when the repo did not exist', async () => {
    expect(await adapter.delete('acme', 'nonexistent')).toBe(false);
  });

  it('listAll returns every registered repo across orgs', async () => {
    const repo1 = makeMetadata({ org: 'acme', name: 'repo-1' });
    const repo2 = makeMetadata({ org: 'acme', name: 'repo-2' });
    const repo3 = makeMetadata({
      org: 'other-org',
      name: 'repo-3',
      canonicalUrl: 'git@github.com:other-org/repo-3.git',
    });

    await adapter.write('acme', 'repo-1', repo1);
    await adapter.write('acme', 'repo-2', repo2);
    await adapter.write('other-org', 'repo-3', repo3);

    const all = await adapter.listAll();
    expect(all).toHaveLength(3);
    const sorted = all.sort((a, b) => `${a.org}/${a.name}`.localeCompare(`${b.org}/${b.name}`));
    expect(sorted.map((r) => `${r.org}/${r.name}`)).toEqual([
      'acme/repo-1',
      'acme/repo-2',
      'other-org/repo-3',
    ]);
  });

  it('listAll returns empty array when no repos exist', async () => {
    expect(await adapter.listAll()).toEqual([]);
  });

  it('listAll ignores non-metadata keys under the prefix', async () => {
    await adapter.write('acme', 'repo-1', makeMetadata({ org: 'acme', name: 'repo-1' }));
    // A stray object that is not a metadata.json file
    fake.objects.set('repos/acme/repo-1/README.txt', 'noise');
    const all = await adapter.listAll();
    expect(all).toHaveLength(1);
  });

  it('listAll skips malformed metadata documents', async () => {
    await adapter.write('acme', 'good', makeMetadata({ org: 'acme', name: 'good' }));
    fake.objects.set('repos/acme/bad/metadata.json', '{ not valid json');
    const all = await adapter.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe('good');
  });

  it('constructs AWS SDK command instances (real client surface)', async () => {
    // Sanity: the command classes are importable and shaped as expected, so the
    // constructor-name discrimination in the fake matches production behavior.
    expect(new PutObjectCommand({ Bucket: 'b', Key: 'k' }).constructor.name).toBe('PutObjectCommand');
    expect(new GetObjectCommand({ Bucket: 'b', Key: 'k' }).constructor.name).toBe('GetObjectCommand');
    expect(new HeadObjectCommand({ Bucket: 'b', Key: 'k' }).constructor.name).toBe('HeadObjectCommand');
    expect(new DeleteObjectCommand({ Bucket: 'b', Key: 'k' }).constructor.name).toBe('DeleteObjectCommand');
    expect(new ListObjectsV2Command({ Bucket: 'b' }).constructor.name).toBe('ListObjectsV2Command');
  });
});
