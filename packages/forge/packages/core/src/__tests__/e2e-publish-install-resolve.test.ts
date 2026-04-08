import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { stringify as stringifyYaml } from 'yaml';

import { FilesystemAdapter } from '../adapters/filesystem-adapter.js';
import { Registry } from '../registry/registry.js';
import { Resolver } from '../resolver/resolver.js';
import type { LockEntry } from '../resolver/resolver.js';
import type { ArtifactBundle, ArtifactMeta } from '../models/index.js';
import {
  VersionConflictError,
  PublishValidationError,
} from '../adapters/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Write an artifact directly in versioned directory layout.
 * This seeds the filesystem so that `FilesystemAdapter.detectVersions`
 * recognises the artifact as versioned (subdirectory named after semver).
 */
async function writeVersioned(
  root: string,
  typeDir: string,
  id: string,
  version: string,
  meta: Record<string, unknown>,
  contentFileName: string,
  content: string,
): Promise<void> {
  const dir = path.join(root, typeDir, id, version);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'metadata.yaml'), stringifyYaml(meta), 'utf-8');
  if (content) {
    await fs.writeFile(path.join(dir, contentFileName), content, 'utf-8');
  }
}

/**
 * Read a file from inside a versioned artifact directory.
 */
async function readVersionedFile(
  root: string,
  typeDir: string,
  id: string,
  version: string,
  fileName: string,
): Promise<string> {
  return fs.readFile(
    path.join(root, typeDir, id, version, fileName),
    'utf-8',
  );
}

/**
 * Check if a file exists inside a versioned artifact directory.
 */
async function versionedFileExists(
  root: string,
  typeDir: string,
  id: string,
  version: string,
  fileName: string,
): Promise<boolean> {
  try {
    await fs.access(path.join(root, typeDir, id, version, fileName));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('E2E: publish -> install -> resolve cycle', () => {
  let tmpDir: string;
  let adapter: FilesystemAdapter;
  let registry: Registry;
  let resolver: Resolver;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-e2e-'));
    adapter = new FilesystemAdapter(tmpDir);
    registry = new Registry(adapter, 'e2e-local');
    resolver = new Resolver(registry);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Scenario 1: Publish multiple versions and resolve
  // -----------------------------------------------------------------------
  describe('Scenario 1: Publish multiple versions and resolve', () => {
    const skillMeta100 = {
      id: 'test-skill',
      name: 'Test Skill',
      version: '1.0.0',
      description: 'A test skill v1.0.0',
      type: 'skill' as const,
      tags: ['test'],
      dependencies: {},
      files: [],
    };

    const skillContent100 = '# Test Skill v1.0.0\nOriginal content.';

    const skillMeta110 = {
      ...skillMeta100,
      version: '1.1.0',
      description: 'A test skill v1.1.0',
    };

    const skillContent110 = '# Test Skill v1.1.0\nUpdated content.';

    it('publishes v1.0.0 and v1.1.0, then resolves them correctly', async () => {
      // Seed v1.0.0 in versioned layout so the adapter detects versioned dirs
      await writeVersioned(
        tmpDir, 'skills', 'test-skill', '1.0.0',
        skillMeta100, 'SKILL.md', skillContent100,
      );

      // Publish v1.1.0 via Registry.publish (adapter detects existing versioned layout)
      const bundle110: ArtifactBundle = {
        meta: skillMeta110 as ArtifactMeta,
        content: skillContent110,
        contentPath: 'SKILL.md',
      };
      const result = await registry.publish('skill', 'test-skill', bundle110);
      expect(result.version).toBe('1.1.0');
      expect(result.registry).toBe('e2e-local');

      // Verify both versions exist
      const versions = await registry.listVersions('skill', 'test-skill');
      expect(versions).toContain('1.0.0');
      expect(versions).toContain('1.1.0');
      expect(versions[0]).toBe('1.1.0'); // highest first

      // Resolve @latest -> 1.1.0
      const latestResolved = await resolver.resolve({
        type: 'skill', id: 'test-skill', version: 'latest',
      });
      expect(latestResolved.ref.version).toBe('1.1.0');

      // Resolve @^1.0.0 -> 1.1.0 (highest matching)
      resolver.reset();
      const rangeResolved = await resolver.resolve({
        type: 'skill', id: 'test-skill', version: '^1.0.0',
      });
      expect(rangeResolved.ref.version).toBe('1.1.0');

      // Resolve @1.0.0 -> exactly 1.0.0
      resolver.reset();
      const exactResolved = await resolver.resolve({
        type: 'skill', id: 'test-skill', version: '1.0.0',
      });
      expect(exactResolved.ref.version).toBe('1.0.0');
      expect(exactResolved.bundle.content).toBe(skillContent100);

      // Verify manifest.yaml was generated for v1.1.0
      const manifestExists = await versionedFileExists(
        tmpDir, 'skills', 'test-skill', '1.1.0', 'metadata.yaml',
      );
      expect(manifestExists).toBe(true);

      // Verify the published file checksums match
      expect(result.files[0]!.sha256).toBe(sha256(skillContent110));
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 2: Publish plugin with skill dependency
  // -----------------------------------------------------------------------
  describe('Scenario 2: Plugin with skill dependency', () => {
    it('resolves plugin dependencies and picks up new skill versions', async () => {
      // Publish skill:helper@1.0.0
      await writeVersioned(tmpDir, 'skills', 'helper', '1.0.0', {
        id: 'helper',
        name: 'Helper Skill',
        version: '1.0.0',
        description: 'A helper skill',
        type: 'skill',
        tags: [],
        dependencies: {},
        files: [],
      }, 'SKILL.md', '# Helper v1.0.0');

      // Publish plugin:my-plugin@1.0.0 with dependency on helper
      await writeVersioned(tmpDir, 'plugins', 'my-plugin', '1.0.0', {
        id: 'my-plugin',
        name: 'My Plugin',
        version: '1.0.0',
        description: 'A test plugin',
        type: 'plugin',
        tags: [],
        skills: ['helper'],
        agents: [],
      }, 'PLUGIN.md', '# My Plugin v1.0.0');

      // Resolve plugin -> should include helper@1.0.0
      const resolved = await resolver.resolve({
        type: 'plugin', id: 'my-plugin', version: '1.0.0',
      });
      expect(resolved.ref.version).toBe('1.0.0');
      expect(resolved.dependencies).toHaveLength(1);
      expect(resolved.dependencies[0]!.ref.id).toBe('helper');
      expect(resolved.dependencies[0]!.ref.version).toBe('1.0.0');

      // Now publish helper@1.1.0
      const helperBundle110: ArtifactBundle = {
        meta: {
          id: 'helper',
          name: 'Helper Skill',
          version: '1.1.0',
          description: 'A helper skill updated',
          type: 'skill',
          tags: [],
          dependencies: {},
          files: [],
        } as ArtifactMeta,
        content: '# Helper v1.1.0',
        contentPath: 'SKILL.md',
      };
      await registry.publish('skill', 'helper', helperBundle110);

      // Re-resolve plugin (reset to clear caches)
      resolver.reset();
      const resolved2 = await resolver.resolve({
        type: 'plugin', id: 'my-plugin', version: '1.0.0',
      });
      // Plugin's skill dependency uses wildcard (*), so it picks up latest = 1.1.0
      expect(resolved2.dependencies[0]!.ref.version).toBe('1.1.0');
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 3: Workspace inheritance
  // -----------------------------------------------------------------------
  describe('Scenario 3: Workspace inheritance', () => {
    it('resolves extended workspace config with merged fields', async () => {
      // Publish workspace-config:base@1.0.0
      await writeVersioned(tmpDir, 'workspace-configs', 'base', '1.0.0', {
        id: 'base',
        name: 'Base Config',
        version: '1.0.0',
        description: 'Base workspace configuration',
        type: 'workspace-config',
        tags: [],
        plugins: ['my-plugin'],
        skills: [],
        personas: [],
        mcp_servers: {
          anvil: { description: 'Anvil server', required: true },
        },
        settings: {},
        git_workflow: {},
      }, 'WORKSPACE.md', '');

      // Publish workspace-config:extended@1.0.0 extending base
      await writeVersioned(tmpDir, 'workspace-configs', 'extended', '1.0.0', {
        id: 'extended',
        name: 'Extended Config',
        version: '1.0.0',
        description: 'Extended workspace configuration',
        type: 'workspace-config',
        tags: [],
        extends: 'base@1.0.0',
        plugins: [],
        skills: ['extra-skill'],
        personas: [],
        mcp_servers: {
          vault: { description: 'Vault server', required: false },
        },
        settings: {},
        git_workflow: {},
      }, 'WORKSPACE.md', '');

      // We also need the plugin and skill to exist for dependency resolution
      await writeVersioned(tmpDir, 'plugins', 'my-plugin', '1.0.0', {
        id: 'my-plugin',
        name: 'My Plugin',
        version: '1.0.0',
        description: 'A plugin',
        type: 'plugin',
        tags: [],
        skills: [],
        agents: [],
      }, 'PLUGIN.md', '');

      await writeVersioned(tmpDir, 'skills', 'extra-skill', '1.0.0', {
        id: 'extra-skill',
        name: 'Extra Skill',
        version: '1.0.0',
        description: 'An extra skill',
        type: 'skill',
        tags: [],
        dependencies: {},
        files: [],
      }, 'SKILL.md', '');

      // Resolve the extended config
      const resolved = await resolver.resolve({
        type: 'workspace-config', id: 'extended', version: '1.0.0',
      });

      // The merged metadata should contain:
      const meta = resolved.bundle.meta as Record<string, unknown>;

      // Plugins from base (my-plugin) should be present
      expect(meta.plugins).toEqual(expect.arrayContaining(['my-plugin']));

      // Skills from child (extra-skill) should be present
      expect(meta.skills).toEqual(expect.arrayContaining(['extra-skill']));

      // mcp_servers merged: both anvil (from base) and vault (from child)
      const servers = meta.mcp_servers as Record<string, unknown>;
      expect(servers).toHaveProperty('anvil');
      expect(servers).toHaveProperty('vault');
      expect((servers.anvil as Record<string, unknown>).required).toBe(true);
      expect((servers.vault as Record<string, unknown>).required).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 4: Version conflict
  // -----------------------------------------------------------------------
  describe('Scenario 4: Version conflict', () => {
    it('rejects publishing a version that already exists', async () => {
      // Seed v1.0.0
      await writeVersioned(tmpDir, 'skills', 'test', '1.0.0', {
        id: 'test',
        name: 'Test',
        version: '1.0.0',
        description: 'A test skill',
        type: 'skill',
        tags: [],
        dependencies: {},
        files: [],
      }, 'SKILL.md', '# test');

      // Try to publish v1.0.0 again via Registry.publish
      const bundle: ArtifactBundle = {
        meta: {
          id: 'test',
          name: 'Test',
          version: '1.0.0',
          description: 'A test skill duplicate',
          type: 'skill',
          tags: [],
          dependencies: {},
          files: [],
        } as ArtifactMeta,
        content: '# test duplicate',
        contentPath: 'SKILL.md',
      };

      await expect(
        registry.publish('skill', 'test', bundle),
      ).rejects.toThrow(VersionConflictError);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 5: Validation failures
  // -----------------------------------------------------------------------
  describe('Scenario 5: Validation failures', () => {
    it('rejects publish with missing required field (description)', async () => {
      const bundle: ArtifactBundle = {
        meta: {
          id: 'bad-skill',
          name: 'Bad Skill',
          version: '1.0.0',
          // description is missing
          type: 'skill',
          tags: [],
        } as unknown as ArtifactMeta,
        content: '# Bad Skill',
        contentPath: 'SKILL.md',
      };
      // Remove description so Zod sees it as missing
      delete (bundle.meta as Record<string, unknown>)['description'];

      await expect(
        registry.publish('skill', 'bad-skill', bundle),
      ).rejects.toThrow(PublishValidationError);
    });

    it('rejects publish with invalid semver', async () => {
      const bundle: ArtifactBundle = {
        meta: {
          id: 'bad-version',
          name: 'Bad Version',
          version: 'not-a-semver',
          description: 'Has an invalid version',
          type: 'skill',
          tags: [],
        } as unknown as ArtifactMeta,
        content: '# Bad Version',
        contentPath: 'SKILL.md',
      };

      await expect(
        registry.publish('skill', 'bad-version', bundle),
      ).rejects.toThrow(PublishValidationError);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 6: Lock entries
  // -----------------------------------------------------------------------
  describe('Scenario 6: Lock entries', () => {
    it('produces lock entries with artifact ref, resolved version, and SHA-256', async () => {
      // Publish skill:lock-skill@1.0.0
      await writeVersioned(tmpDir, 'skills', 'lock-skill', '1.0.0', {
        id: 'lock-skill',
        name: 'Lock Skill',
        version: '1.0.0',
        description: 'Skill for lock test',
        type: 'skill',
        tags: [],
        dependencies: {},
        files: [],
      }, 'SKILL.md', '# Lock Skill v1.0.0');

      // Publish plugin:lock-plugin@1.0.0 depending on lock-skill
      await writeVersioned(tmpDir, 'plugins', 'lock-plugin', '1.0.0', {
        id: 'lock-plugin',
        name: 'Lock Plugin',
        version: '1.0.0',
        description: 'Plugin for lock test',
        type: 'plugin',
        tags: [],
        skills: ['lock-skill'],
        agents: [],
      }, 'PLUGIN.md', '# Lock Plugin v1.0.0');

      // Resolve the plugin (which pulls in the skill dependency)
      await resolver.resolve({
        type: 'plugin', id: 'lock-plugin', version: '1.0.0',
      });

      // Get lock entries
      const lockEntries = resolver.getLockEntries();
      expect(lockEntries.length).toBeGreaterThanOrEqual(2);

      // Find entries by key
      const pluginEntry = lockEntries.find(
        (e: LockEntry) => e.key === 'plugin:lock-plugin',
      );
      const skillEntry = lockEntries.find(
        (e: LockEntry) => e.key === 'skill:lock-skill',
      );

      expect(pluginEntry).toBeDefined();
      expect(skillEntry).toBeDefined();

      // Verify each entry has the required fields
      for (const entry of [pluginEntry!, skillEntry!]) {
        expect(entry.key).toBeTruthy();
        expect(entry.requestedRange).toBeTruthy();
        expect(entry.resolvedVersion).toMatch(/^\d+\.\d+\.\d+$/);
        expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
      }

      // Verify resolved versions
      expect(pluginEntry!.resolvedVersion).toBe('1.0.0');
      expect(skillEntry!.resolvedVersion).toBe('1.0.0');
    });
  });
});
