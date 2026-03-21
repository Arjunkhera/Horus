// Unit tests for type source tracking in TypeRegistry

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TypeRegistry } from '../../src/registry/type-registry.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('TypeRegistry - Type Source Tracking', () => {
  let tmpDir: string;
  let vaultDir: string;
  let pluginDir: string;
  let pluginTypesDir: string;
  let vaultTypesDir: string;

  beforeEach(() => {
    // Create temporary directories for testing
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anvil-source-tracking-test-'));

    // Vault structure: .anvil/types/
    vaultDir = path.join(tmpDir, '.anvil');
    vaultTypesDir = path.join(vaultDir, 'types');
    fs.mkdirSync(vaultDir, { recursive: true });
    fs.mkdirSync(vaultTypesDir);

    // Plugin structure: .anvil/plugins/{name}/types/
    pluginDir = path.join(vaultDir, 'plugins', 'my-plugin');
    pluginTypesDir = path.join(pluginDir, 'types');
    fs.mkdirSync(pluginTypesDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temporary directories
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should populate source.directory and source.file for vault types', async () => {
    // Create _core in vault
    fs.writeFileSync(
      path.join(vaultTypesDir, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    // Create task in vault
    fs.writeFileSync(
      path.join(vaultTypesDir, 'task.yaml'),
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
    const err = await registry.loadTypes(vaultTypesDir);

    expect(err).toBeUndefined();

    const taskType = registry.getType('task');
    expect(taskType).toBeDefined();
    expect(taskType!.source).toBeDefined();
    expect(taskType!.source.directory).toBe(vaultTypesDir);
    expect(taskType!.source.file).toBe('task.yaml');
    expect(taskType!.source.plugin).toBeUndefined();
  });

  it('should extract plugin name from directory path', async () => {
    // Create _core in vault
    fs.writeFileSync(
      path.join(vaultTypesDir, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    // Create plugin type
    fs.writeFileSync(
      path.join(pluginTypesDir, 'custom-item.yaml'),
      `id: custom_item
name: Custom Item
extends: _core
fields:
  custom_field:
    type: string
`
    );

    const registry = new TypeRegistry();
    await registry.loadTypes([vaultTypesDir, pluginTypesDir]);

    const customType = registry.getType('custom_item');
    expect(customType).toBeDefined();
    expect(customType!.source).toBeDefined();
    expect(customType!.source.directory).toBe(pluginTypesDir);
    expect(customType!.source.file).toBe('custom-item.yaml');
    expect(customType!.source.plugin).toBe('my-plugin');
  });

  it('should return undefined for plugin name on vault types', async () => {
    // Create _core in vault
    fs.writeFileSync(
      path.join(vaultTypesDir, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    // Create note in vault
    fs.writeFileSync(
      path.join(vaultTypesDir, 'note.yaml'),
      `id: note
name: Note
extends: _core
fields:
  content:
    type: text
`
    );

    const registry = new TypeRegistry();
    const err = await registry.loadTypes(vaultTypesDir);

    expect(err).toBeUndefined();

    const noteType = registry.getType('note');
    expect(noteType!.source.plugin).toBeUndefined();
  });

  it('should log structured conflict warning with source info', async () => {
    // Create _core in vault
    fs.writeFileSync(
      path.join(vaultTypesDir, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    // Create task v1 in vault
    fs.writeFileSync(
      path.join(vaultTypesDir, 'task.yaml'),
      `id: task
name: Task v1
extends: _core
fields:
  status:
    type: enum
    values: [open, closed]
`
    );

    // Create task v2 in plugin (should be ignored)
    fs.writeFileSync(
      path.join(pluginTypesDir, 'task.yaml'),
      `id: task
name: Task v2
extends: _core
fields:
  priority:
    type: number
`
    );

    let warnMessage = '';
    const originalWarn = console.warn;
    console.warn = (msg: string) => {
      warnMessage = msg;
    };

    try {
      const registry = new TypeRegistry();
      const err = await registry.loadTypes([vaultTypesDir, pluginTypesDir]);

      expect(err).toBeUndefined();

      // Check the warning message format
      expect(warnMessage).toContain("Type conflict: 'task'");
      expect(warnMessage).toContain('defined in both');
      expect(warnMessage).toContain('higher precedence');
      expect(warnMessage).toContain(vaultTypesDir);
      expect(warnMessage).toContain('task.yaml');

      // The loaded type should be the vault version (v1)
      expect(registry.getType('task')?.name).toBe('Task v1');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('should support getTypesBySource with plugin name', async () => {
    // Create _core and vault types
    fs.writeFileSync(
      path.join(vaultTypesDir, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    fs.writeFileSync(
      path.join(vaultTypesDir, 'task.yaml'),
      `id: task
name: Task
extends: _core
fields:
  status:
    type: enum
    values: [open, closed]
`
    );

    // Create plugin types
    fs.writeFileSync(
      path.join(pluginTypesDir, 'custom_item.yaml'),
      `id: custom_item
name: Custom Item
extends: _core
fields:
  custom_field:
    type: string
`
    );

    fs.writeFileSync(
      path.join(pluginTypesDir, 'widget.yaml'),
      `id: widget
name: Widget
extends: _core
fields:
  widget_data:
    type: text
`
    );

    const registry = new TypeRegistry();
    await registry.loadTypes([vaultTypesDir, pluginTypesDir]);

    // Get types by plugin name
    const pluginTypes = registry.getTypesBySource('my-plugin');

    expect(pluginTypes).toHaveLength(2);
    const pluginTypeIds = pluginTypes.map((t) => t.id).sort();
    expect(pluginTypeIds).toEqual(['custom_item', 'widget']);
  });

  it('should support getTypesBySource with directory path', async () => {
    // Create _core and vault types
    fs.writeFileSync(
      path.join(vaultTypesDir, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    fs.writeFileSync(
      path.join(vaultTypesDir, 'task.yaml'),
      `id: task
name: Task
extends: _core
fields:
  status:
    type: enum
    values: [open, closed]
`
    );

    fs.writeFileSync(
      path.join(vaultTypesDir, 'note.yaml'),
      `id: note
name: Note
extends: _core
fields:
  content:
    type: text
`
    );

    // Create plugin type
    fs.writeFileSync(
      path.join(pluginTypesDir, 'custom_item.yaml'),
      `id: custom_item
name: Custom Item
extends: _core
fields:
  custom_field:
    type: string
`
    );

    const registry = new TypeRegistry();
    await registry.loadTypes([vaultTypesDir, pluginTypesDir]);

    // Get types by vault directory path
    const vaultTypes = registry.getTypesBySource(vaultTypesDir);

    expect(vaultTypes).toHaveLength(3); // _core, task, note
    const vaultTypeIds = vaultTypes.map((t) => t.id).sort();
    expect(vaultTypeIds).toEqual(['_core', 'note', 'task']);
  });

  it('should support getTypesByPlugin convenience method', async () => {
    // Create _core and vault types
    fs.writeFileSync(
      path.join(vaultTypesDir, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    fs.writeFileSync(
      path.join(vaultTypesDir, 'task.yaml'),
      `id: task
name: Task
extends: _core
fields:
  status:
    type: enum
    values: [open, closed]
`
    );

    // Create plugin types
    fs.writeFileSync(
      path.join(pluginTypesDir, 'custom_item.yaml'),
      `id: custom_item
name: Custom Item
extends: _core
fields:
  custom_field:
    type: string
`
    );

    fs.writeFileSync(
      path.join(pluginTypesDir, 'widget.yaml'),
      `id: widget
name: Widget
extends: _core
fields:
  widget_data:
    type: text
`
    );

    const registry = new TypeRegistry();
    await registry.loadTypes([vaultTypesDir, pluginTypesDir]);

    // Get types by plugin name using convenience method
    const pluginTypes = registry.getTypesByPlugin('my-plugin');

    expect(pluginTypes).toHaveLength(2);
    const pluginTypeIds = pluginTypes.map((t) => t.id).sort();
    expect(pluginTypeIds).toEqual(['custom_item', 'widget']);
  });

  it('should return empty array for getTypesByPlugin with nonexistent plugin', async () => {
    fs.writeFileSync(
      path.join(vaultTypesDir, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    const registry = new TypeRegistry();
    await registry.loadTypes(vaultTypesDir);

    const pluginTypes = registry.getTypesByPlugin('nonexistent-plugin');

    expect(pluginTypes).toHaveLength(0);
  });

  it('should handle multiple plugins with distinct type namespaces', async () => {
    // Create _core and vault types
    fs.writeFileSync(
      path.join(vaultTypesDir, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    // Create second plugin directory
    const plugin2Dir = path.join(vaultDir, 'plugins', 'other-plugin');
    const plugin2TypesDir = path.join(plugin2Dir, 'types');
    fs.mkdirSync(plugin2TypesDir, { recursive: true });

    // Plugin 1 types
    fs.writeFileSync(
      path.join(pluginTypesDir, 'custom_item.yaml'),
      `id: custom_item
name: Custom Item
extends: _core
fields:
  custom_field:
    type: string
`
    );

    // Plugin 2 types
    fs.writeFileSync(
      path.join(plugin2TypesDir, 'other_item.yaml'),
      `id: other_item
name: Other Item
extends: _core
fields:
  other_field:
    type: string
`
    );

    const registry = new TypeRegistry();
    await registry.loadTypes([vaultTypesDir, pluginTypesDir, plugin2TypesDir]);

    // Get types by plugin 1
    const plugin1Types = registry.getTypesByPlugin('my-plugin');
    expect(plugin1Types).toHaveLength(1);
    expect(plugin1Types[0].id).toBe('custom_item');

    // Get types by plugin 2
    const plugin2Types = registry.getTypesByPlugin('other-plugin');
    expect(plugin2Types).toHaveLength(1);
    expect(plugin2Types[0].id).toBe('other_item');
  });

  it('should correctly source info in ResolvedType inheritance chains', async () => {
    // Create _core in vault
    fs.writeFileSync(
      path.join(vaultTypesDir, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
    required: true
`
    );

    // Create base type in vault
    fs.writeFileSync(
      path.join(vaultTypesDir, 'task.yaml'),
      `id: task
name: Task
extends: _core
fields:
  status:
    type: enum
    values: [open, closed]
`
    );

    // Create extended type in plugin (extends type from vault)
    fs.writeFileSync(
      path.join(pluginTypesDir, 'story.yaml'),
      `id: story
name: Story
extends: task
fields:
  epic:
    type: reference
    ref_type: epic
`
    );

    const registry = new TypeRegistry();
    await registry.loadTypes([vaultTypesDir, pluginTypesDir]);

    // Story should have plugin source, but should inherit from task
    const storyType = registry.getType('story');
    expect(storyType).toBeDefined();
    expect(storyType!.source.directory).toBe(pluginTypesDir);
    expect(storyType!.source.file).toBe('story.yaml');
    expect(storyType!.source.plugin).toBe('my-plugin');

    // Verify inheritance still works
    expect(storyType!.extends).toBe('task');
    expect(storyType!.fields).toHaveProperty('status');
    expect(storyType!.fields).toHaveProperty('epic');
  });
});
