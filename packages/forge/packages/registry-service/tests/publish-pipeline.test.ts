/**
 * Tests for the publish pipeline.
 *
 * Uses a no-op in-memory StorageBackend and AuditLog to isolate the pipeline logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stringify as yamlStringify } from 'yaml';
import {
  PublishPipeline,
  PipelineError,
  SUPPORTED_TYPES,
} from '../src/pipeline/publish-pipeline.js';
import type { StorageBackend, BundleFiles, StoredBundle } from '../src/storage/types.js';
import type { AuditLog } from '../src/audit/audit-log.js';
import type { AuthStrategy } from '../src/auth/types.js';
import type { ServiceUser } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_USER: ServiceUser = { userId: 'admin-1', name: 'Admin', role: 'admin' };
const ANON_USER = null;

function makeSkillMetaYaml(overrides: Record<string, unknown> = {}): string {
  return yamlStringify({
    id: 'my-skill',
    name: 'My Skill',
    version: '1.0.0',
    description: 'A test skill',
    type: 'skill',
    tags: [],
    dependencies: {},
    files: [],
    ...overrides,
  });
}

function makeFiles(overrides: Record<string, string> = {}): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  files.set('metadata.yaml', Buffer.from(makeSkillMetaYaml()));
  files.set('SKILL.md', Buffer.from('# My Skill\nContent here.'));
  for (const [k, v] of Object.entries(overrides)) {
    files.set(k, Buffer.from(v));
  }
  return files;
}

// ---------------------------------------------------------------------------
// Stub implementations
// ---------------------------------------------------------------------------

function makeStorage(opts: { exists?: boolean } = {}): StorageBackend {
  return {
    ping: vi.fn().mockResolvedValue(true),
    exists: vi.fn().mockResolvedValue(opts.exists ?? false),
    getMeta: vi.fn().mockResolvedValue(null),
    writeBundle: vi.fn().mockResolvedValue(undefined),
    readBundle: vi.fn().mockResolvedValue(new Map() as StoredBundle),
    listVersions: vi.fn().mockResolvedValue([]),
  };
}

function makeAuditLog(): AuditLog {
  return {
    append: vi.fn().mockResolvedValue(undefined),
    recent: vi.fn().mockResolvedValue([]),
    close: vi.fn(),
  } as unknown as AuditLog;
}

function makeAuth(decision: 'permit' | 'deny' = 'permit'): AuthStrategy {
  return {
    identify: vi.fn().mockResolvedValue(ADMIN_USER),
    authorize: vi.fn().mockReturnValue(decision),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PublishPipeline', () => {
  let storage: StorageBackend;
  let auditLog: AuditLog;
  let auth: AuthStrategy;
  let pipeline: PublishPipeline;

  beforeEach(() => {
    storage = makeStorage();
    auditLog = makeAuditLog();
    auth = makeAuth('permit');
    pipeline = new PublishPipeline(storage, auditLog, auth, '0.1.0');
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns 201 result on valid publish', async () => {
    const result = await pipeline.run({
      type: 'skill',
      id: 'my-skill',
      version: '1.0.0',
      files: makeFiles(),
      coreVersionHeader: '0.1.0',
      caller: ADMIN_USER,
    });

    expect(result.type).toBe('skill');
    expect(result.id).toBe('my-skill');
    expect(result.version).toBe('1.0.0');
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.manifest).toContain('version:');
    expect(result.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('calls storage.writeBundle with manifest included', async () => {
    await pipeline.run({
      type: 'skill',
      id: 'my-skill',
      version: '1.0.0',
      files: makeFiles(),
      coreVersionHeader: undefined,
      caller: ADMIN_USER,
    });

    const writeSpy = vi.mocked(storage.writeBundle);
    expect(writeSpy).toHaveBeenCalledOnce();
    const [, , , bundleFiles] = writeSpy.mock.calls[0] as [string, string, string, BundleFiles];
    expect(bundleFiles.has('manifest.yaml')).toBe(true);
  });

  it('appends audit log entry with actor userId', async () => {
    await pipeline.run({
      type: 'skill',
      id: 'my-skill',
      version: '1.0.0',
      files: makeFiles(),
      coreVersionHeader: undefined,
      caller: ADMIN_USER,
    });

    const appendSpy = vi.mocked(auditLog.append);
    expect(appendSpy).toHaveBeenCalledOnce();
    const entry = appendSpy.mock.calls[0][0];
    expect(entry.actor).toBe('admin-1');
    expect(entry.action).toBe('publish');
    expect(entry.targetType).toBe('skill');
  });

  it('uses "anonymous" as actor when caller is null', async () => {
    // Allow anonymous publish for this test (permissive auth)
    await pipeline.run({
      type: 'skill',
      id: 'my-skill',
      version: '1.0.0',
      files: makeFiles(),
      coreVersionHeader: undefined,
      caller: ANON_USER,
    });

    const entry = vi.mocked(auditLog.append).mock.calls[0][0];
    expect(entry.actor).toBe('anonymous');
  });

  // ── Type validation ───────────────────────────────────────────────────────

  it('rejects unknown artifact type with 400 + supportedTypes', async () => {
    await expect(
      pipeline.run({
        type: 'widget',
        id: 'my-widget',
        version: '1.0.0',
        files: makeFiles(),
        coreVersionHeader: undefined,
        caller: ADMIN_USER,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      const e = err as PipelineError;
      return e instanceof PipelineError &&
        e.httpStatus === 400 &&
        e.code === 'UNKNOWN_TYPE' &&
        Array.isArray(e.extra?.['supportedTypes']);
    });
  });

  it('supported types list matches SUPPORTED_TYPES constant', async () => {
    const caught = await pipeline
      .run({
        type: 'unknown-type',
        id: 'x',
        version: '1.0.0',
        files: makeFiles(),
        coreVersionHeader: undefined,
        caller: ADMIN_USER,
      })
      .catch((e) => e as PipelineError);

    expect(caught.extra?.['supportedTypes']).toEqual(SUPPORTED_TYPES);
  });

  // ── Core version compatibility ────────────────────────────────────────────

  it('accepts matching major version', async () => {
    await expect(
      pipeline.run({
        type: 'skill',
        id: 'my-skill',
        version: '1.0.0',
        files: makeFiles(),
        coreVersionHeader: '0.5.3', // same major 0
        caller: ADMIN_USER,
      }),
    ).resolves.toBeDefined();
  });

  it('rejects mismatched major version with 409/426', async () => {
    const pipeline2 = new PublishPipeline(storage, auditLog, auth, '1.0.0');
    const err = await pipeline2
      .run({
        type: 'skill',
        id: 'my-skill',
        version: '1.0.0',
        files: makeFiles(),
        coreVersionHeader: '2.0.0', // client is ahead → 426
        caller: ADMIN_USER,
      })
      .catch((e) => e as PipelineError);

    expect(err).toBeInstanceOf(PipelineError);
    expect(err.code).toBe('CORE_VERSION_INCOMPATIBLE');
    expect([409, 426]).toContain(err.httpStatus);
  });

  it('rejects invalid semver in X-Forge-Core-Version', async () => {
    await expect(
      pipeline.run({
        type: 'skill',
        id: 'my-skill',
        version: '1.0.0',
        files: makeFiles(),
        coreVersionHeader: 'not-a-version',
        caller: ADMIN_USER,
      }),
    ).rejects.toSatisfy((e: unknown) => (e as PipelineError).code === 'INVALID_CORE_VERSION');
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('rejects publish when auth returns deny with 403', async () => {
    auth = makeAuth('deny');
    pipeline = new PublishPipeline(storage, auditLog, auth, '0.1.0');

    await expect(
      pipeline.run({
        type: 'skill',
        id: 'my-skill',
        version: '1.0.0',
        files: makeFiles(),
        coreVersionHeader: undefined,
        caller: null,
      }),
    ).rejects.toSatisfy((e: unknown) => {
      const err = e as PipelineError;
      return err instanceof PipelineError && err.httpStatus === 403;
    });
  });

  // ── Schema validation ─────────────────────────────────────────────────────

  it('rejects missing metadata.yaml with 400', async () => {
    const files = new Map<string, Buffer>([['SKILL.md', Buffer.from('content')]]);
    await expect(
      pipeline.run({
        type: 'skill',
        id: 'my-skill',
        version: '1.0.0',
        files,
        coreVersionHeader: undefined,
        caller: ADMIN_USER,
      }),
    ).rejects.toSatisfy((e: unknown) => (e as PipelineError).code === 'MISSING_METADATA');
  });

  it('rejects invalid metadata YAML with 400', async () => {
    const files = new Map<string, Buffer>([
      ['metadata.yaml', Buffer.from('{invalid: yaml: content: [}')],
    ]);
    await expect(
      pipeline.run({
        type: 'skill',
        id: 'my-skill',
        version: '1.0.0',
        files,
        coreVersionHeader: undefined,
        caller: ADMIN_USER,
      }),
    ).rejects.toSatisfy((e: unknown) => (e as PipelineError).code === 'INVALID_METADATA_YAML');
  });

  it('rejects metadata that fails Zod schema with 400', async () => {
    const files = new Map<string, Buffer>([
      ['metadata.yaml', Buffer.from(yamlStringify({ id: 'x', type: 'skill' }))],
    ]);
    await expect(
      pipeline.run({
        type: 'skill',
        id: 'x',
        version: '1.0.0',
        files,
        coreVersionHeader: undefined,
        caller: ADMIN_USER,
      }),
    ).rejects.toSatisfy((e: unknown) => (e as PipelineError).code === 'SCHEMA_VALIDATION_FAILED');
  });

  it('rejects version mismatch between URL and metadata.yaml', async () => {
    const files = new Map<string, Buffer>([
      ['metadata.yaml', Buffer.from(makeSkillMetaYaml({ version: '2.0.0' }))],
    ]);
    await expect(
      pipeline.run({
        type: 'skill',
        id: 'my-skill',
        version: '1.0.0', // URL says 1.0.0 but metadata says 2.0.0
        files,
        coreVersionHeader: undefined,
        caller: ADMIN_USER,
      }),
    ).rejects.toSatisfy((e: unknown) => (e as PipelineError).code === 'VERSION_MISMATCH');
  });

  it('rejects id mismatch between URL and metadata.yaml', async () => {
    const files = new Map<string, Buffer>([
      ['metadata.yaml', Buffer.from(makeSkillMetaYaml({ id: 'other-id' }))],
    ]);
    await expect(
      pipeline.run({
        type: 'skill',
        id: 'my-skill', // URL id
        version: '1.0.0',
        files,
        coreVersionHeader: undefined,
        caller: ADMIN_USER,
      }),
    ).rejects.toSatisfy((e: unknown) => (e as PipelineError).code === 'ID_MISMATCH');
  });

  // ── Immutability ──────────────────────────────────────────────────────────

  it('rejects re-publish of existing version with 409', async () => {
    storage = makeStorage({ exists: true });
    pipeline = new PublishPipeline(storage, auditLog, auth, '0.1.0');

    await expect(
      pipeline.run({
        type: 'skill',
        id: 'my-skill',
        version: '1.0.0',
        files: makeFiles(),
        coreVersionHeader: undefined,
        caller: ADMIN_USER,
      }),
    ).rejects.toSatisfy((e: unknown) => {
      const err = e as PipelineError;
      return err instanceof PipelineError && err.httpStatus === 409 && err.code === 'VERSION_CONFLICT';
    });
  });

  // ── SHA-256 checksums ─────────────────────────────────────────────────────

  it('includes sha256 for each input file in result.files', async () => {
    const result = await pipeline.run({
      type: 'skill',
      id: 'my-skill',
      version: '1.0.0',
      files: makeFiles(),
      coreVersionHeader: undefined,
      caller: ADMIN_USER,
    });

    const names = result.files.map((f) => f.name);
    expect(names).toContain('metadata.yaml');
    expect(names).toContain('SKILL.md');
    for (const f of result.files) {
      expect(f.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
