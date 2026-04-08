import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'crypto';
import type { DataAdapter } from '../../adapters/types.js';
import type { ArtifactBundle, ArtifactMeta } from '../../models/index.js';
import { Registry } from '../registry.js';
import type { PublishResult } from '../registry.js';
import { VersionConflictError, PublishValidationError } from '../../adapters/errors.js';

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function createMockAdapter(overrides: Partial<DataAdapter> = {}): DataAdapter {
  return {
    list: vi.fn().mockResolvedValue([]),
    read: vi.fn().mockResolvedValue({} as ArtifactBundle),
    exists: vi.fn().mockResolvedValue(false),
    write: vi.fn().mockResolvedValue(undefined),
    listVersions: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function validSkillMeta(overrides: Partial<ArtifactMeta> = {}): ArtifactMeta {
  return {
    id: 'test-skill',
    name: 'Test Skill',
    version: '1.0.0',
    description: 'A test skill for publish validation',
    type: 'skill' as const,
    tags: ['test'],
    dependencies: {},
    files: [],
    ...overrides,
  } as ArtifactMeta;
}

function validBundle(metaOverrides: Partial<ArtifactMeta> = {}): ArtifactBundle {
  return {
    meta: validSkillMeta(metaOverrides),
    content: '# Test Skill\nThis is a test skill.',
    contentPath: 'SKILL.md',
  };
}

describe('Registry.publish()', () => {
  let adapter: DataAdapter;
  let registry: Registry;

  beforeEach(() => {
    adapter = createMockAdapter();
    registry = new Registry(adapter, 'test-registry');
  });

  it('publishes valid artifact and returns structured result', async () => {
    const bundle = validBundle();
    const result = await registry.publish('skill', 'test-skill', bundle);

    expect(result).toEqual<PublishResult>({
      type: 'skill',
      id: 'test-skill',
      version: '1.0.0',
      registry: 'test-registry',
      files: [
        { name: 'SKILL.md', sha256: sha256(bundle.content) },
      ],
    });
  });

  it('calls adapter.write with the bundle', async () => {
    const bundle = validBundle();
    await registry.publish('skill', 'test-skill', bundle);

    expect(adapter.write).toHaveBeenCalledTimes(1);
    const writeCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(writeCall[0]).toBe('skill');
    expect(writeCall[1]).toBe('test-skill');
    // The bundle passed to write should include a manifest property
    expect(writeCall[2]).toHaveProperty('manifest');
    expect(typeof writeCall[2].manifest).toBe('string');
  });

  it('throws PublishValidationError for invalid metadata (missing required fields)', async () => {
    const bundle = validBundle({ description: undefined } as unknown as Partial<ArtifactMeta>);
    // Remove required description field
    delete (bundle.meta as Record<string, unknown>)['description'];

    await expect(
      registry.publish('skill', 'test-skill', bundle),
    ).rejects.toThrow(PublishValidationError);
  });

  it('throws PublishValidationError for invalid metadata (bad id format)', async () => {
    const bundle = validBundle({ id: 'UPPERCASE_BAD' } as unknown as Partial<ArtifactMeta>);

    await expect(
      registry.publish('skill', 'test-skill', bundle),
    ).rejects.toThrow(PublishValidationError);
  });

  it('throws PublishValidationError for invalid semver version', async () => {
    const bundle = validBundle({ version: 'not-semver' } as unknown as Partial<ArtifactMeta>);

    await expect(
      registry.publish('skill', 'test-skill', bundle),
    ).rejects.toThrow(PublishValidationError);
  });

  it('throws VersionConflictError when version already exists', async () => {
    adapter = createMockAdapter({
      listVersions: vi.fn().mockResolvedValue(['1.0.0', '0.9.0']),
    });
    registry = new Registry(adapter, 'test-registry');

    const bundle = validBundle();

    await expect(
      registry.publish('skill', 'test-skill', bundle),
    ).rejects.toThrow(VersionConflictError);
  });

  it('does not throw when version does not exist yet', async () => {
    adapter = createMockAdapter({
      listVersions: vi.fn().mockResolvedValue(['0.9.0', '0.8.0']),
    });
    registry = new Registry(adapter, 'test-registry');

    const bundle = validBundle();
    const result = await registry.publish('skill', 'test-skill', bundle);
    expect(result.version).toBe('1.0.0');
  });

  it('generates manifest.yaml with correct checksums', async () => {
    const bundle = validBundle();
    await registry.publish('skill', 'test-skill', bundle);

    const writeCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const manifestStr: string = writeCall[2].manifest;

    // Manifest should contain the version
    expect(manifestStr).toContain('version: "1.0.0"');
    // Manifest should contain the file name
    expect(manifestStr).toContain('name: "SKILL.md"');
    // Manifest should contain correct SHA-256
    const expectedHash = sha256(bundle.content);
    expect(manifestStr).toContain(`sha256: "${expectedHash}"`);
    // Manifest should contain published_at as ISO timestamp
    expect(manifestStr).toMatch(/published_at: "\d{4}-\d{2}-\d{2}T/);
  });

  it('returns correct structured result with all fields', async () => {
    const bundle = validBundle();
    const result = await registry.publish('skill', 'test-skill', bundle);

    expect(result.type).toBe('skill');
    expect(result.id).toBe('test-skill');
    expect(result.version).toBe('1.0.0');
    expect(result.registry).toBe('test-registry');
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.name).toBe('SKILL.md');
    expect(result.files[0]!.sha256).toHaveLength(64); // SHA-256 hex length
  });

  it('validates agent metadata correctly', async () => {
    const agentBundle: ArtifactBundle = {
      meta: {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        description: 'A test agent',
        type: 'agent' as const,
        rootSkill: 'orchestrator',
        tags: [],
        skills: [],
        dependencies: {},
      } as ArtifactMeta,
      content: '# Test Agent',
      contentPath: 'AGENT.md',
    };

    const result = await registry.publish('agent', 'test-agent', agentBundle);
    expect(result.type).toBe('agent');
    expect(result.version).toBe('1.0.0');
  });

  it('rejects agent metadata missing rootSkill', async () => {
    const agentBundle: ArtifactBundle = {
      meta: {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        description: 'A test agent',
        type: 'agent' as const,
        tags: [],
        dependencies: {},
        skills: [],
        // rootSkill intentionally omitted to test validation
      } as unknown as ArtifactMeta,
      content: '# Test Agent',
      contentPath: 'AGENT.md',
    };

    await expect(
      registry.publish('agent', 'test-agent', agentBundle),
    ).rejects.toThrow(PublishValidationError);
  });

  it('skips version conflict check when adapter has no listVersions', async () => {
    adapter = createMockAdapter();
    delete (adapter as Partial<DataAdapter>).listVersions;
    registry = new Registry(adapter, 'test-registry');

    const bundle = validBundle();
    const result = await registry.publish('skill', 'test-skill', bundle);
    expect(result.version).toBe('1.0.0');
  });

  it('uses default registry name when none provided', async () => {
    const defaultRegistry = new Registry(adapter);
    const bundle = validBundle();
    const result = await defaultRegistry.publish('skill', 'test-skill', bundle);
    expect(result.registry).toBe('default');
  });
});
