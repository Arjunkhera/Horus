// Unit tests for type watcher (Story 017: Hot reload)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TypeRegistry } from '../../src/registry/type-registry.js';
import { createTypeWatcher } from '../../src/watcher/type-watcher.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('TypeRegistry - reload() method', () => {
  let tmpDir: string;
  let dir1: string;
  let dir2: string;

  beforeEach(() => {
    // Create temporary directories for testing
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anvil-reload-test-'));
    dir1 = path.join(tmpDir, 'dir1');
    dir2 = path.join(tmpDir, 'dir2');
    fs.mkdirSync(dir1);
    fs.mkdirSync(dir2);
  });

  afterEach(() => {
    // Clean up temporary directories
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should reload types successfully with same directories', async () => {
    // Create _core.yaml in dir1
    fs.writeFileSync(
      path.join(dir1, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    // Create task.yaml in dir1
    fs.writeFileSync(
      path.join(dir1, 'task.yaml'),
      `id: task
name: Task
extends: _core
fields:
  status:
    type: enum
    values: [open, closed]
`
    );

    const registry = new TypeRegistry();
    const initialErr = await registry.loadTypes([dir1]);
    expect(initialErr).toBeUndefined();
    expect(registry.hasType('_core')).toBe(true);
    expect(registry.hasType('task')).toBe(true);

    // Reload with same directories
    const reloadErr = await registry.reload([dir1]);
    expect(reloadErr).toBeUndefined();
    expect(registry.hasType('_core')).toBe(true);
    expect(registry.hasType('task')).toBe(true);
  });

  it('should reload and add new types from additional directory', async () => {
    // dir1: _core and task
    fs.writeFileSync(
      path.join(dir1, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    fs.writeFileSync(
      path.join(dir1, 'task.yaml'),
      `id: task
name: Task
extends: _core
fields:
  status:
    type: enum
    values: [open, closed]
`
    );

    const registry = new TypeRegistry();
    const initialErr = await registry.loadTypes([dir1]);
    expect(initialErr).toBeUndefined();
    expect(registry.hasType('task')).toBe(true);
    expect(registry.hasType('note')).toBe(false);

    // Add new type to dir2
    fs.writeFileSync(
      path.join(dir2, 'note.yaml'),
      `id: note
name: Note
extends: _core
fields:
  content:
    type: text
`
    );

    // Reload with both directories
    const reloadErr = await registry.reload([dir1, dir2]);
    expect(reloadErr).toBeUndefined();
    expect(registry.hasType('task')).toBe(true);
    expect(registry.hasType('note')).toBe(true);
  });

  it('should remove types when reloading without a directory', async () => {
    // dir1: _core and task
    fs.writeFileSync(
      path.join(dir1, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    fs.writeFileSync(
      path.join(dir1, 'task.yaml'),
      `id: task
name: Task
extends: _core
fields:
  status:
    type: enum
    values: [open, closed]
`
    );

    // dir2: _core (needed for validation) and note
    fs.writeFileSync(
      path.join(dir2, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    fs.writeFileSync(
      path.join(dir2, 'note.yaml'),
      `id: note
name: Note
extends: _core
fields:
  content:
    type: text
`
    );

    const registry = new TypeRegistry();
    const initialErr = await registry.loadTypes([dir1, dir2]);
    expect(initialErr).toBeUndefined();
    expect(registry.hasType('task')).toBe(true);
    expect(registry.hasType('note')).toBe(true);

    // Reload with only dir2 (no task, but has _core and note)
    const reloadErr = await registry.reload([dir2]);
    expect(reloadErr).toBeUndefined();
    expect(registry.hasType('note')).toBe(true);
    // task should be gone
    expect(registry.hasType('task')).toBe(false);
  });

  it('should preserve previous types on reload failure', async () => {
    // dir1: valid _core and task
    fs.writeFileSync(
      path.join(dir1, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    fs.writeFileSync(
      path.join(dir1, 'task.yaml'),
      `id: task
name: Task
extends: _core
fields:
  status:
    type: enum
    values: [open, closed]
`
    );

    const registry = new TypeRegistry();
    const initialErr = await registry.loadTypes([dir1]);
    expect(initialErr).toBeUndefined();
    expect(registry.hasType('task')).toBe(true);

    // Create invalid YAML in dir2
    fs.writeFileSync(
      path.join(dir2, 'invalid.yaml'),
      `id: invalid
name: Invalid
extends: _core
fields:
  badfield:
    type: nonexistent_type
`
    );

    // Reload with dir2 (should fail)
    const reloadErr = await registry.reload([dir1, dir2]);
    expect(reloadErr).toBeDefined();
    expect('error' in (reloadErr || {})).toBe(true);

    // Old types should still be present
    expect(registry.hasType('task')).toBe(true);
  });

  it('should log info message on successful reload', async () => {
    // Create _core.yaml in dir1
    fs.writeFileSync(
      path.join(dir1, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    const registry = new TypeRegistry();
    const initialErr = await registry.loadTypes([dir1]);
    expect(initialErr).toBeUndefined();

    const infoSpy = vi.spyOn(console, 'info');
    const reloadErr = await registry.reload([dir1]);
    expect(reloadErr).toBeUndefined();

    // Verify info log message
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('Type registry reloaded successfully')
    );

    infoSpy.mockRestore();
  });
});

describe('createTypeWatcher', () => {
  let tmpDir: string;
  let vaultPath: string;

  beforeEach(() => {
    // Create temporary vault structure
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anvil-watcher-test-'));
    vaultPath = tmpDir;
    const anvilDir = path.join(vaultPath, '.anvil');
    const typesDir = path.join(anvilDir, 'types');
    const pluginsDir = path.join(anvilDir, 'plugins');

    fs.mkdirSync(anvilDir, { recursive: true });
    fs.mkdirSync(typesDir, { recursive: true });
    fs.mkdirSync(pluginsDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temporary directories
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return an object with a close method', () => {
    const initialTypeDirs = [path.join(vaultPath, '.anvil', 'types')];
    const mockReload = vi.fn();

    const watcher = createTypeWatcher({
      vaultPath,
      initialTypeDirs,
      onReload: mockReload,
    });

    expect(watcher).toBeDefined();
    expect(typeof watcher.close).toBe('function');
  });

  it('should handle close without errors', async () => {
    const initialTypeDirs = [path.join(vaultPath, '.anvil', 'types')];
    const mockReload = vi.fn();

    const watcher = createTypeWatcher({
      vaultPath,
      initialTypeDirs,
      onReload: mockReload,
    });

    // Should not throw
    await expect(watcher.close()).resolves.not.toThrow();
  });

  it('should debounce reload calls', async () => {
    const initialTypeDirs = [path.join(vaultPath, '.anvil', 'types')];
    const mockReload = vi.fn().mockResolvedValue(undefined);

    const watcher = createTypeWatcher({
      vaultPath,
      initialTypeDirs,
      onReload: mockReload,
      debounceMs: 100,
    });

    try {
      const typesDir = path.join(vaultPath, '.anvil', 'types');

      // Create a YAML file
      fs.writeFileSync(
        path.join(typesDir, 'test.yaml'),
        `id: test
name: Test
fields:
  title:
    type: string
`
      );

      // Give the watcher time to detect the file
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Modify the file multiple times rapidly
      for (let i = 0; i < 3; i++) {
        fs.writeFileSync(
          path.join(typesDir, 'test.yaml'),
          `id: test
name: Test
fields:
  title:
    type: string
  updated:
    type: boolean
`
        );
      }

      // Give debounce time to complete
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Should have called reload, but much fewer times than file writes
      expect(mockReload.mock.calls.length).toBeLessThan(3);

      await watcher.close();
    } catch (err) {
      await watcher.close();
      throw err;
    }
  });
});
