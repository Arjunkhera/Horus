/**
 * Tests for cross-artifact references validation (publish pipeline) and
 * the GET /artifacts/:type/:id/:version/deps endpoint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stringify as yamlStringify } from 'yaml';
import {
  PublishPipeline,
  PipelineError,
} from '../src/pipeline/publish-pipeline.js';
import { registerDepsRoute } from '../src/routes/deps.js';
import type { StorageBackend, BundleFiles, StoredBundle } from '../src/storage/types.js';
import type { AuditLog } from '../src/audit/audit-log.js';
import type { AuthStrategy } from '../src/auth/types.js';
import type { ServiceUser } from '../src/types.js';
import Fastify from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_USER: ServiceUser = { userId: 'admin-1', name: 'Admin', role: 'admin' };

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

function makeAgentMetaYaml(overrides: Record<string, unknown> = {}): string {
  return yamlStringify({
    id: 'my-agent',
    name: 'My Agent',
    version: '1.0.0',
    description: 'A test agent',
    type: 'agent',
    rootSkill: 'my-skill',
    tags: [],
    ...overrides,
  });
}

function makeWorkspaceConfigMetaYaml(overrides: Record<string, unknown> = {}): string {
  return yamlStringify({
    id: 'my-config',
    name: 'My Config',
    version: '1.0.0',
    description: 'A test workspace config',
    type: 'workspace-config',
    tags: [],
    ...overrides,
  });
}

function makeFiles(
  metaYaml: string,
  extra: Record<string, string> = {},
): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  files.set('metadata.yaml', Buffer.from(metaYaml));
  files.set('SKILL.md', Buffer.from('# Content'));
  for (const [k, v] of Object.entries(extra)) {
    files.set(k, Buffer.from(v));
  }
  return files;
}

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

/**
 * Storage stub that tracks which (type, id, version) tuples "exist".
 * `existingArtifacts` is a set of `type:id@version` keys.
 * `bundles` maps the same key to a bundle's metadata yaml content for readBundle().
 */
function makeStorage(
  existingArtifacts: Set<string> = new Set(),
  bundles: Map<string, string> = new Map(),
): StorageBackend {
  const existsFn = vi.fn(async (type: string, id: string, version: string) => {
    return existingArtifacts.has(`${type}:${id}@${version}`);
  });

  const readBundleFn = vi.fn(async (type: string, id: string, version: string) => {
    const key = `${type}:${id}@${version}`;
    const yaml = bundles.get(key);
    if (yaml === undefined) {
      throw new Error(`Not found: ${key}`);
    }
    const result = new Map<string, Buffer>();
    result.set('metadata.yaml', Buffer.from(yaml));
    return result as StoredBundle;
  });

  return {
    ping: vi.fn().mockResolvedValue(true),
    exists: existsFn,
    getMeta: vi.fn().mockResolvedValue(null),
    writeBundle: vi.fn().mockResolvedValue(undefined),
    readBundle: readBundleFn,
    listVersions: vi.fn().mockResolvedValue([]),
    listAll: vi.fn().mockResolvedValue([]),
    isVerified: vi.fn().mockResolvedValue(false),
    isVersionRevoked: vi.fn().mockResolvedValue(false),
  };
}

function makeAuditLog(): AuditLog {
  return {
    append: vi.fn().mockResolvedValue(undefined),
    recent: vi.fn().mockResolvedValue([]),
    close: vi.fn(),
  } as unknown as AuditLog;
}

function makeAuth(): AuthStrategy {
  return {
    identify: vi.fn().mockResolvedValue(ADMIN_USER),
    authorize: vi.fn().mockReturnValue('permit'),
  };
}

// ---------------------------------------------------------------------------
// Publish pipeline — references validation
// ---------------------------------------------------------------------------

describe('PublishPipeline — references validation', () => {
  let auditLog: AuditLog;
  let auth: AuthStrategy;

  beforeEach(() => {
    auditLog = makeAuditLog();
    auth = makeAuth();
  });

  it('publishes successfully when references exist and are allowed (agent → skill)', async () => {
    // skill:my-skill@1.0.0 exists in storage
    const existingArtifacts = new Set(['skill:my-skill@1.0.0']);
    const storage = makeStorage(existingArtifacts);
    const pipeline = new PublishPipeline(storage, auditLog, auth, '0.1.0');

    const metaYaml = makeAgentMetaYaml({
      references: [{ type: 'skill', id: 'my-skill', version: '1.0.0' }],
    });

    const result = await pipeline.run({
      type: 'agent',
      id: 'my-agent',
      version: '1.0.0',
      files: makeFiles(metaYaml),
      coreVersionHeader: undefined,
      caller: ADMIN_USER,
    });

    expect(result.type).toBe('agent');
    expect(result.id).toBe('my-agent');
  });

  it('publishes successfully when artifact has no references', async () => {
    const storage = makeStorage();
    const pipeline = new PublishPipeline(storage, auditLog, auth, '0.1.0');

    const metaYaml = makeSkillMetaYaml();
    const result = await pipeline.run({
      type: 'skill',
      id: 'my-skill',
      version: '1.0.0',
      files: makeFiles(metaYaml),
      coreVersionHeader: undefined,
      caller: ADMIN_USER,
    });

    expect(result.type).toBe('skill');
  });

  it('publishes successfully when workspace-config references both plugin and skill', async () => {
    const existingArtifacts = new Set(['plugin:my-plugin@1.0.0', 'skill:my-skill@1.0.0']);
    const storage = makeStorage(existingArtifacts);
    const pipeline = new PublishPipeline(storage, auditLog, auth, '0.1.0');

    const metaYaml = makeWorkspaceConfigMetaYaml({
      references: [
        { type: 'plugin', id: 'my-plugin', version: '1.0.0' },
        { type: 'skill', id: 'my-skill', version: '1.0.0' },
      ],
    });

    const result = await pipeline.run({
      type: 'workspace-config',
      id: 'my-config',
      version: '1.0.0',
      files: makeFiles(metaYaml),
      coreVersionHeader: undefined,
      caller: ADMIN_USER,
    });

    expect(result.type).toBe('workspace-config');
  });

  it('rejects publish when reference type is disallowed (skill → anything)', async () => {
    // Skills cannot reference anything
    const existingArtifacts = new Set(['agent:some-agent@1.0.0']);
    const storage = makeStorage(existingArtifacts);
    const pipeline = new PublishPipeline(storage, auditLog, auth, '0.1.0');

    const metaYaml = makeSkillMetaYaml({
      references: [{ type: 'agent', id: 'some-agent', version: '1.0.0' }],
    });

    await expect(
      pipeline.run({
        type: 'skill',
        id: 'my-skill',
        version: '1.0.0',
        files: makeFiles(metaYaml),
        coreVersionHeader: undefined,
        caller: ADMIN_USER,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      const e = err as PipelineError;
      return (
        e instanceof PipelineError &&
        e.httpStatus === 400 &&
        e.code === 'DISALLOWED_REFERENCE_TYPE' &&
        Array.isArray(e.extra?.['supportedTargets'])
      );
    });
  });

  it('rejects publish when agent references a plugin (not allowed)', async () => {
    const existingArtifacts = new Set(['plugin:my-plugin@1.0.0']);
    const storage = makeStorage(existingArtifacts);
    const pipeline = new PublishPipeline(storage, auditLog, auth, '0.1.0');

    const metaYaml = makeAgentMetaYaml({
      references: [{ type: 'plugin', id: 'my-plugin', version: '1.0.0' }],
    });

    const err = await pipeline
      .run({
        type: 'agent',
        id: 'my-agent',
        version: '1.0.0',
        files: makeFiles(metaYaml),
        coreVersionHeader: undefined,
        caller: ADMIN_USER,
      })
      .catch((e) => e as PipelineError);

    expect(err).toBeInstanceOf(PipelineError);
    expect(err.code).toBe('DISALLOWED_REFERENCE_TYPE');
    expect(err.extra?.['supportedTargets']).toEqual(['skill']);
  });

  it('rejects publish when referenced artifact does not exist in storage', async () => {
    // No artifacts pre-seeded — skill:missing@2.0.0 is not there
    const storage = makeStorage(new Set());
    const pipeline = new PublishPipeline(storage, auditLog, auth, '0.1.0');

    const metaYaml = makeAgentMetaYaml({
      references: [{ type: 'skill', id: 'missing', version: '2.0.0' }],
    });

    await expect(
      pipeline.run({
        type: 'agent',
        id: 'my-agent',
        version: '1.0.0',
        files: makeFiles(metaYaml),
        coreVersionHeader: undefined,
        caller: ADMIN_USER,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      const e = err as PipelineError;
      return (
        e instanceof PipelineError &&
        e.httpStatus === 400 &&
        e.code === 'REFERENCE_NOT_FOUND' &&
        (e.extra?.['missingRef'] as Record<string, string>)?.['id'] === 'missing'
      );
    });
  });

  it('includes missingRef details in REFERENCE_NOT_FOUND error', async () => {
    const storage = makeStorage(new Set());
    const pipeline = new PublishPipeline(storage, auditLog, auth, '0.1.0');

    const metaYaml = makeAgentMetaYaml({
      references: [{ type: 'skill', id: 'gone-skill', version: '3.5.1' }],
    });

    const err = await pipeline
      .run({
        type: 'agent',
        id: 'my-agent',
        version: '1.0.0',
        files: makeFiles(metaYaml),
        coreVersionHeader: undefined,
        caller: ADMIN_USER,
      })
      .catch((e) => e as PipelineError);

    expect(err.code).toBe('REFERENCE_NOT_FOUND');
    expect(err.extra?.['missingRef']).toEqual({
      type: 'skill',
      id: 'gone-skill',
      version: '3.5.1',
    });
  });
});

// ---------------------------------------------------------------------------
// Deps endpoint
// ---------------------------------------------------------------------------

/**
 * Build a lightweight Fastify app with only the deps route registered.
 */
function buildDepsApp(storage: StorageBackend) {
  const app = Fastify({ logger: false });
  registerDepsRoute(app, storage);
  return app;
}

describe('GET /artifacts/:type/:id/:version/deps', () => {
  it('returns empty deps for an artifact with no references', async () => {
    const skillYaml = makeSkillMetaYaml(); // no references field
    const bundles = new Map([['skill:my-skill@1.0.0', skillYaml]]);
    const existing = new Set(['skill:my-skill@1.0.0']);
    const storage = makeStorage(existing, bundles);
    const app = buildDepsApp(storage);

    const response = await app.inject({
      method: 'GET',
      url: '/artifacts/skill/my-skill/1.0.0/deps',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.type).toBe('skill');
    expect(body.id).toBe('my-skill');
    expect(body.version).toBe('1.0.0');
    expect(body.verified).toBe(false);
    expect(body.deps).toEqual([]);
  });

  it('returns correct single-level dependency tree', async () => {
    // agent → skill
    const skillYaml = makeSkillMetaYaml();
    const agentYaml = makeAgentMetaYaml({
      references: [{ type: 'skill', id: 'my-skill', version: '1.0.0' }],
    });

    const bundles = new Map([
      ['skill:my-skill@1.0.0', skillYaml],
      ['agent:my-agent@1.0.0', agentYaml],
    ]);
    const existing = new Set(['skill:my-skill@1.0.0', 'agent:my-agent@1.0.0']);
    const storage = makeStorage(existing, bundles);
    const app = buildDepsApp(storage);

    const response = await app.inject({
      method: 'GET',
      url: '/artifacts/agent/my-agent/1.0.0/deps',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.type).toBe('agent');
    expect(body.deps).toHaveLength(1);
    expect(body.deps[0]).toMatchObject({
      type: 'skill',
      id: 'my-skill',
      version: '1.0.0',
      verified: false,
      deps: [],
    });
  });

  it('walks transitive dependencies recursively', async () => {
    // workspace-config → plugin → skill
    const skillYaml = makeSkillMetaYaml({ id: 'base-skill' });
    const pluginYaml = yamlStringify({
      id: 'my-plugin',
      name: 'My Plugin',
      version: '1.0.0',
      description: 'A plugin',
      type: 'plugin',
      tags: [],
      references: [{ type: 'skill', id: 'base-skill', version: '1.0.0' }],
    });
    const configYaml = makeWorkspaceConfigMetaYaml({
      references: [{ type: 'plugin', id: 'my-plugin', version: '1.0.0' }],
    });

    const bundles = new Map([
      ['skill:base-skill@1.0.0', skillYaml],
      ['plugin:my-plugin@1.0.0', pluginYaml],
      ['workspace-config:my-config@1.0.0', configYaml],
    ]);
    const existing = new Set([
      'skill:base-skill@1.0.0',
      'plugin:my-plugin@1.0.0',
      'workspace-config:my-config@1.0.0',
    ]);
    const storage = makeStorage(existing, bundles);
    const app = buildDepsApp(storage);

    const response = await app.inject({
      method: 'GET',
      url: '/artifacts/workspace-config/my-config/1.0.0/deps',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.type).toBe('workspace-config');
    expect(body.deps).toHaveLength(1);

    const plugin = body.deps[0];
    expect(plugin.type).toBe('plugin');
    expect(plugin.id).toBe('my-plugin');
    expect(plugin.deps).toHaveLength(1);
    expect(plugin.deps[0]).toMatchObject({ type: 'skill', id: 'base-skill', deps: [] });
  });

  it('returns 409 with CIRCULAR_DEPENDENCY when cycle is detected', async () => {
    // a → b → a  (circular)
    const aYaml = makeAgentMetaYaml({
      id: 'agent-a',
      references: [{ type: 'agent', id: 'agent-b', version: '1.0.0' }],
    });
    const bYaml = makeAgentMetaYaml({
      id: 'agent-b',
      references: [{ type: 'agent', id: 'agent-a', version: '1.0.0' }],
    });

    const bundles = new Map([
      ['agent:agent-a@1.0.0', aYaml],
      ['agent:agent-b@1.0.0', bYaml],
    ]);
    const existing = new Set(['agent:agent-a@1.0.0', 'agent:agent-b@1.0.0']);
    const storage = makeStorage(existing, bundles);
    const app = buildDepsApp(storage);

    const response = await app.inject({
      method: 'GET',
      url: '/artifacts/agent/agent-a/1.0.0/deps',
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.error).toBe('CIRCULAR_DEPENDENCY');
    expect(body.message).toContain('Circular dependency detected');
  });

  it('returns 404 when artifact does not exist', async () => {
    const storage = makeStorage(new Set());
    const app = buildDepsApp(storage);

    const response = await app.inject({
      method: 'GET',
      url: '/artifacts/skill/nonexistent/1.0.0/deps',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('NOT_FOUND');
  });

  it('returns 400 for unknown artifact type', async () => {
    const storage = makeStorage(new Set());
    const app = buildDepsApp(storage);

    const response = await app.inject({
      method: 'GET',
      url: '/artifacts/widget/some-id/1.0.0/deps',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('UNKNOWN_TYPE');
  });

  it('each dep node has verified: false when storage returns unverified', async () => {
    const agentYaml = makeAgentMetaYaml({
      references: [{ type: 'skill', id: 'my-skill', version: '1.0.0' }],
    });
    const skillYaml = makeSkillMetaYaml();

    const bundles = new Map([
      ['agent:my-agent@1.0.0', agentYaml],
      ['skill:my-skill@1.0.0', skillYaml],
    ]);
    const existing = new Set(['agent:my-agent@1.0.0', 'skill:my-skill@1.0.0']);
    const storage = makeStorage(existing, bundles);
    const app = buildDepsApp(storage);

    const response = await app.inject({
      method: 'GET',
      url: '/artifacts/agent/my-agent/1.0.0/deps',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.verified).toBe(false);
    expect(body.deps[0].verified).toBe(false);
  });

  it('sets verified: true on nodes when isVerified returns true', async () => {
    const skillYaml = makeSkillMetaYaml();
    const bundles = new Map([['skill:my-skill@1.0.0', skillYaml]]);
    const existing = new Set(['skill:my-skill@1.0.0']);

    // Build storage with isVerified returning true for all artifacts
    const storage = makeStorage(existing, bundles);
    (storage.isVerified as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const app = buildDepsApp(storage);
    const response = await app.inject({
      method: 'GET',
      url: '/artifacts/skill/my-skill/1.0.0/deps',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.verified).toBe(true);
  });

  it('sets verified: false when version is revoked even if artifact-level isVerified is true', async () => {
    const skillYaml = makeSkillMetaYaml();
    const bundles = new Map([['skill:my-skill@1.0.0', skillYaml]]);
    const existing = new Set(['skill:my-skill@1.0.0']);

    // Artifact-level verified = true, but this specific version is revoked
    const storage = makeStorage(existing, bundles);
    (storage.isVerified as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (storage.isVersionRevoked as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const app = buildDepsApp(storage);
    const response = await app.inject({
      method: 'GET',
      url: '/artifacts/skill/my-skill/1.0.0/deps',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // Per-version revocation overrides artifact-id level verification
    expect(body.verified).toBe(false);
  });

  it('install proceeds and returns dep verification summary (no-block policy)', async () => {
    // Verify the endpoint still returns 200 even with unverified deps —
    // the caller (installer) receives the tree and decides what to show.
    const agentYaml = makeAgentMetaYaml({
      references: [{ type: 'skill', id: 'my-skill', version: '1.0.0' }],
    });
    const skillYaml = makeSkillMetaYaml();
    const bundles = new Map([
      ['agent:my-agent@1.0.0', agentYaml],
      ['skill:my-skill@1.0.0', skillYaml],
    ]);
    const existing = new Set(['agent:my-agent@1.0.0', 'skill:my-skill@1.0.0']);

    // Only the agent is verified; the dep skill is not
    const storage = makeStorage(existing, bundles);
    (storage.isVerified as ReturnType<typeof vi.fn>).mockImplementation(
      async (_type: string, id: string) => id === 'my-agent',
    );

    const app = buildDepsApp(storage);
    const response = await app.inject({
      method: 'GET',
      url: '/artifacts/agent/my-agent/1.0.0/deps',
    });

    // Endpoint succeeds (no block on unverified deps)
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.verified).toBe(true);           // agent is verified
    expect(body.deps[0].verified).toBe(false);  // skill dep is unverified
  });
});
