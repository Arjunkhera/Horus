/**
 * Tests for S3StorageBackend using mocked @aws-sdk/client-s3.
 *
 * All S3 calls are intercepted via vi.mock — no real S3 traffic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { S3StorageConfig } from '../src/config.js';

// ---------------------------------------------------------------------------
// Mock the S3 SDK before importing the backend
// ---------------------------------------------------------------------------

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
    PutObjectCommand: vi.fn().mockImplementation((input) => ({ _type: 'Put', input })),
    GetObjectCommand: vi.fn().mockImplementation((input) => ({ _type: 'Get', input })),
    HeadObjectCommand: vi.fn().mockImplementation((input) => ({ _type: 'Head', input })),
    ListObjectsV2Command: vi.fn().mockImplementation((input) => ({ _type: 'List', input })),
  };
});

// Import after mock setup
const { S3StorageBackend } = await import('../src/storage/s3-backend.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CONFIG: S3StorageConfig = {
  backend: 's3',
  bucket: 'test-bucket',
  region: 'us-east-1',
  prefix: '',
  forcePathStyle: false,
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
};

function makeBackend(configOverrides: Partial<S3StorageConfig> = {}): InstanceType<typeof S3StorageBackend> {
  return new S3StorageBackend({ ...TEST_CONFIG, ...configOverrides });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('S3StorageBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── ping ─────────────────────────────────────────────────────────────────

  it('ping() resolves true when S3 responds', async () => {
    mockSend.mockResolvedValueOnce({ Contents: [] });
    const backend = makeBackend();
    await expect(backend.ping()).resolves.toBe(true);
  });

  it('ping() throws a descriptive error when S3 is unreachable', async () => {
    mockSend.mockRejectedValueOnce(new Error('Network error'));
    const backend = makeBackend();
    await expect(backend.ping()).rejects.toThrow(/S3 backend unavailable/);
  });

  // ── exists ────────────────────────────────────────────────────────────────

  it('exists() returns true when HeadObject succeeds', async () => {
    mockSend.mockResolvedValueOnce({ ContentLength: 100 });
    const backend = makeBackend();
    await expect(backend.exists('skill', 'my-skill', '1.0.0')).resolves.toBe(true);
  });

  it('exists() returns false on 404', async () => {
    const notFound = Object.assign(new Error('Not Found'), {
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    });
    mockSend.mockRejectedValueOnce(notFound);
    const backend = makeBackend();
    await expect(backend.exists('skill', 'my-skill', '1.0.0')).resolves.toBe(false);
  });

  it('exists() re-throws non-404 errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('InternalError'));
    const backend = makeBackend();
    await expect(backend.exists('skill', 'my-skill', '1.0.0')).rejects.toThrow();
  });

  // ── key structure ─────────────────────────────────────────────────────────

  it('uses correct S3 key: skills/{id}/{version}/{filename}', async () => {
    mockSend.mockResolvedValueOnce({ ContentLength: 1 }); // exists HEAD
    const backend = makeBackend();
    await backend.exists('skill', 'developer', '2.3.0');

    const headCall = mockSend.mock.calls[0][0];
    expect(headCall.input.Key).toBe('skills/developer/2.3.0/manifest.yaml');
    expect(headCall.input.Bucket).toBe('test-bucket');
  });

  it('respects prefix in object keys', async () => {
    mockSend.mockResolvedValueOnce({ ContentLength: 1 });
    const backend = makeBackend({ prefix: 'registry/' });
    await backend.exists('plugin', 'my-plugin', '1.0.0');

    const headCall = mockSend.mock.calls[0][0];
    expect(headCall.input.Key).toBe('registry/plugins/my-plugin/1.0.0/manifest.yaml');
  });

  it('maps workspace-config type to workspace-configs/', async () => {
    mockSend.mockResolvedValueOnce({ ContentLength: 1 });
    const backend = makeBackend();
    await backend.exists('workspace-config', 'sdlc-default', '1.0.0');

    const headCall = mockSend.mock.calls[0][0];
    expect(headCall.input.Key).toBe('workspace-configs/sdlc-default/1.0.0/manifest.yaml');
  });

  // ── writeBundle ───────────────────────────────────────────────────────────

  it('writes all files and uploads manifest last', async () => {
    mockSend.mockResolvedValue({}); // all PutObject succeed

    const backend = makeBackend();
    const files = new Map<string, Buffer | string>([
      ['metadata.yaml', Buffer.from('id: x')],
      ['SKILL.md', 'content'],
      ['manifest.yaml', 'manifest content'],
    ]);

    await backend.writeBundle('skill', 'x', '1.0.0', files);

    // manifest.yaml should be the last PutObject call
    const calls = mockSend.mock.calls;
    expect(calls.length).toBe(3);
    const lastKey = calls[calls.length - 1][0].input.Key as string;
    expect(lastKey).toMatch(/\/manifest\.yaml$/);
  });

  it('throws when manifest.yaml is missing from BundleFiles', async () => {
    const backend = makeBackend();
    const files = new Map<string, Buffer | string>([
      ['metadata.yaml', Buffer.from('id: x')],
    ]);

    await expect(backend.writeBundle('skill', 'x', '1.0.0', files)).rejects.toThrow(
      /manifest.yaml/,
    );
  });

  // ── listVersions ──────────────────────────────────────────────────────────

  it('returns sorted semver versions descending', async () => {
    mockSend.mockResolvedValueOnce({
      CommonPrefixes: [
        { Prefix: 'skills/x/1.0.0/' },
        { Prefix: 'skills/x/2.0.0/' },
        { Prefix: 'skills/x/1.5.0/' },
      ],
    });

    const backend = makeBackend();
    const versions = await backend.listVersions('skill', 'x');
    expect(versions).toEqual(['2.0.0', '1.5.0', '1.0.0']);
  });

  it('ignores non-semver prefixes', async () => {
    mockSend.mockResolvedValueOnce({
      CommonPrefixes: [
        { Prefix: 'skills/x/1.0.0/' },
        { Prefix: 'skills/x/latest/' }, // not semver
      ],
    });

    const backend = makeBackend();
    const versions = await backend.listVersions('skill', 'x');
    expect(versions).toEqual(['1.0.0']);
  });
});
