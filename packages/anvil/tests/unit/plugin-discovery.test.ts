// Unit tests for plugin type directory discovery

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { discoverPluginTypeDirs } from '../../src/registry/plugin-discovery.js';
import { TypeRegistry } from '../../src/registry/type-registry.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Plugin Discovery', () => {
  let tmpDir: string;
  let vaultPath: string;
  let pluginsDir: string;

  beforeEach(() => {
    // Create temporary vault for testing
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anvil-plugin-discovery-test-'));
    vaultPath = tmpDir;
    pluginsDir = path.join(vaultPath, '.anvil', 'plugins');
  });

  afterEach(() => {
    // Clean up temporary directories
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return empty array when .anvil/plugins/ does not exist', async () => {
    const result = await discoverPluginTypeDirs(vaultPath);
    expect(result).toEqual([]);
  });

  it('should return empty array when plugins directory exists but is empty', async () => {
    fs.mkdirSync(pluginsDir, { recursive: true });

    const result = await discoverPluginTypeDirs(vaultPath);
    expect(result).toEqual([]);
  });

  it('should skip plugin without types/ directory', async () => {
    fs.mkdirSync(path.join(pluginsDir, 'my-plugin'), { recursive: true });

    const result = await discoverPluginTypeDirs(vaultPath);
    expect(result).toEqual([]);
  });

  it('should discover plugin with types/ directory', async () => {
    const typesDir = path.join(pluginsDir, 'my-plugin', 'types');
    fs.mkdirSync(typesDir, { recursive: true });

    const result = await discoverPluginTypeDirs(vaultPath);
    expect(result).toEqual([typesDir]);
  });

  it('should discover multiple plugins and return them sorted alphabetically', async () => {
    // Create plugins in non-alphabetical order to test sorting
    fs.mkdirSync(path.join(pluginsDir, 'zebra-plugin', 'types'), { recursive: true });
    fs.mkdirSync(path.join(pluginsDir, 'alpha-plugin', 'types'), { recursive: true });
    fs.mkdirSync(path.join(pluginsDir, 'beta-plugin', 'types'), { recursive: true });

    const result = await discoverPluginTypeDirs(vaultPath);
    expect(result).toHaveLength(3);

    // Verify alphabetical order
    expect(path.basename(path.dirname(result[0]))).toBe('alpha-plugin');
    expect(path.basename(path.dirname(result[1]))).toBe('beta-plugin');
    expect(path.basename(path.dirname(result[2]))).toBe('zebra-plugin');
  });

  it('should skip plugins without types/ and include those with types/', async () => {
    // Plugin with types
    fs.mkdirSync(path.join(pluginsDir, 'plugin-a', 'types'), { recursive: true });
    // Plugin without types
    fs.mkdirSync(path.join(pluginsDir, 'plugin-b'), { recursive: true });
    // Another plugin with types
    fs.mkdirSync(path.join(pluginsDir, 'plugin-c', 'types'), { recursive: true });

    const result = await discoverPluginTypeDirs(vaultPath);
    expect(result).toHaveLength(2);
    expect(path.basename(path.dirname(result[0]))).toBe('plugin-a');
    expect(path.basename(path.dirname(result[1]))).toBe('plugin-c');
  });

  it('should log plugin info when plugin.json manifest exists', async () => {
    const typesDir = path.join(pluginsDir, 'my-plugin', 'types');
    const manifestPath = path.join(pluginsDir, 'my-plugin', 'plugin.json');

    fs.mkdirSync(typesDir, { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify({ name: 'my-plugin', version: '1.0.0' }));

    // Capture console.info
    let infoMessage = '';
    const originalInfo = console.info;
    console.info = (msg: string) => {
      infoMessage = msg;
    };

    try {
      const result = await discoverPluginTypeDirs(vaultPath);
      expect(result).toEqual([typesDir]);
      expect(infoMessage).toContain('Discovered plugin');
      expect(infoMessage).toContain('my-plugin');
    } finally {
      console.info = originalInfo;
    }
  });

  it('should not log plugin info when plugin.json does not exist', async () => {
    fs.mkdirSync(path.join(pluginsDir, 'my-plugin', 'types'), { recursive: true });

    let infoMessage = '';
    const originalInfo = console.info;
    console.info = (msg: string) => {
      infoMessage = msg;
    };

    try {
      const result = await discoverPluginTypeDirs(vaultPath);
      expect(result).toHaveLength(1);
      expect(infoMessage).toBe('');
    } finally {
      console.info = originalInfo;
    }
  });

  it('should handle non-directory entries in plugins directory', async () => {
    fs.mkdirSync(path.join(pluginsDir, 'plugin-a', 'types'), { recursive: true });
    // Create a file instead of directory
    fs.writeFileSync(path.join(pluginsDir, 'README.md'), '# Plugins');

    const result = await discoverPluginTypeDirs(vaultPath);
    expect(result).toHaveLength(1);
    expect(path.basename(path.dirname(result[0]))).toBe('plugin-a');
  });

  it('integration: full loading pipeline with plugin types', async () => {
    // Set up vault structure
    const vaultTypesDir = path.join(vaultPath, '.anvil', 'types');
    const pluginATypesDir = path.join(pluginsDir, 'plugin-a', 'types');
    const pluginBTypesDir = path.join(pluginsDir, 'plugin-b', 'types');

    fs.mkdirSync(vaultTypesDir, { recursive: true });
    fs.mkdirSync(pluginATypesDir, { recursive: true });
    fs.mkdirSync(pluginBTypesDir, { recursive: true });

    // Create core type (required, in vault)
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

    // Create vault type
    fs.writeFileSync(
      path.join(vaultTypesDir, 'vault-note.yaml'),
      `id: vault-note
name: Vault Note
extends: _core
fields:
  content:
    type: text
`
    );

    // Create plugin A type
    fs.writeFileSync(
      path.join(pluginATypesDir, 'plugin-a-task.yaml'),
      `id: plugin-a-task
name: Plugin A Task
extends: _core
fields:
  status:
    type: enum
    values: [open, closed]
`
    );

    // Create plugin B type
    fs.writeFileSync(
      path.join(pluginBTypesDir, 'plugin-b-crm.yaml'),
      `id: plugin-b-crm
name: Plugin B CRM
extends: _core
fields:
  email:
    type: string
`
    );

    // Discover plugin directories
    const discoveredDirs = await discoverPluginTypeDirs(vaultPath);
    expect(discoveredDirs).toHaveLength(2);

    // Build full type directory list: vault, plugins, then additional
    const typesDirs = [vaultTypesDir, ...discoveredDirs];

    // Load types using registry
    const registry = new TypeRegistry();
    const err = await registry.loadTypes(typesDirs);

    expect(err).toBeUndefined();

    // Verify all types are loaded
    expect(registry.hasType('_core')).toBe(true);
    expect(registry.hasType('vault-note')).toBe(true);
    expect(registry.hasType('plugin-a-task')).toBe(true);
    expect(registry.hasType('plugin-b-crm')).toBe(true);

    // Verify types are accessible and correct
    const pluginATask = registry.getType('plugin-a-task');
    expect(pluginATask?.name).toBe('Plugin A Task');
    expect(pluginATask?.extends).toBe('_core');
    expect(pluginATask?.fields['status']).toBeDefined();

    const pluginBCrm = registry.getType('plugin-b-crm');
    expect(pluginBCrm?.name).toBe('Plugin B CRM');
    expect(pluginBCrm?.fields['email']).toBeDefined();
  });

  it('should resolve conflicts: vault types have precedence over plugin types', async () => {
    const vaultTypesDir = path.join(vaultPath, '.anvil', 'types');
    const pluginTypesDir = path.join(pluginsDir, 'my-plugin', 'types');

    fs.mkdirSync(vaultTypesDir, { recursive: true });
    fs.mkdirSync(pluginTypesDir, { recursive: true });

    // Both define the same type
    fs.writeFileSync(
      path.join(vaultTypesDir, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
`
    );

    fs.writeFileSync(
      path.join(vaultTypesDir, 'task.yaml'),
      `id: task
name: Task (vault version)
extends: _core
fields:
  priority:
    type: enum
    values: [high, low]
`
    );

    fs.writeFileSync(
      path.join(pluginTypesDir, 'task.yaml'),
      `id: task
name: Task (plugin version)
extends: _core
fields:
  severity:
    type: enum
    values: [critical, normal]
`
    );

    const discoveredDirs = await discoverPluginTypeDirs(vaultPath);
    const typesDirs = [vaultTypesDir, ...discoveredDirs];

    const registry = new TypeRegistry();
    const err = await registry.loadTypes(typesDirs);

    expect(err).toBeUndefined();

    // Vault version should win
    const task = registry.getType('task');
    expect(task?.name).toBe('Task (vault version)');
    expect(task?.fields['priority']).toBeDefined();
    expect(task?.fields['severity']).toBeUndefined();
  });

  it('should resolve conflicts: alphabetically first plugin wins on type conflicts between plugins', async () => {
    const pluginATypesDir = path.join(pluginsDir, 'zebra-plugin', 'types');
    const pluginBTypesDir = path.join(pluginsDir, 'alpha-plugin', 'types');

    fs.mkdirSync(pluginATypesDir, { recursive: true });
    fs.mkdirSync(pluginBTypesDir, { recursive: true });

    const vaultTypesDir = path.join(vaultPath, '.anvil', 'types');
    fs.mkdirSync(vaultTypesDir, { recursive: true });

    // Core in vault
    fs.writeFileSync(
      path.join(vaultTypesDir, '_core.yaml'),
      `id: _core
name: Core
fields:
  title:
    type: string
`
    );

    // Both plugins define 'crm-contact' type
    fs.writeFileSync(
      path.join(pluginATypesDir, 'crm-contact.yaml'),
      `id: crm-contact
name: CRM Contact (zebra)
extends: _core
fields:
  phone:
    type: string
`
    );

    fs.writeFileSync(
      path.join(pluginBTypesDir, 'crm-contact.yaml'),
      `id: crm-contact
name: CRM Contact (alpha)
extends: _core
fields:
  website:
    type: url
`
    );

    const discoveredDirs = await discoverPluginTypeDirs(vaultPath);
    // alpha-plugin should come first (alphabetically)
    expect(path.basename(path.dirname(discoveredDirs[0]))).toBe('alpha-plugin');

    const typesDirs = [vaultTypesDir, ...discoveredDirs];
    const registry = new TypeRegistry();
    const err = await registry.loadTypes(typesDirs);

    expect(err).toBeUndefined();

    // Alpha plugin version should win
    const contact = registry.getType('crm-contact');
    expect(contact?.name).toBe('CRM Contact (alpha)');
    expect(contact?.fields['website']).toBeDefined();
    expect(contact?.fields['phone']).toBeUndefined();
  });
});
