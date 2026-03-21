import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { updateClaudeMcpServers, updateCursorMcpServers } from '../mcp-settings-writer.js';

describe('updateClaudeMcpServers', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-mcp-settings-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates settings.local.json with mcpServers and default mcp__*__* permission', async () => {
    await updateClaudeMcpServers(
      [{ name: 'anvil', url: 'http://localhost:8100' }],
      tmpDir,
    );

    const raw = await fs.readFile(
      path.join(tmpDir, '.claude', 'settings.local.json'),
      'utf-8',
    );
    const settings = JSON.parse(raw);

    expect(settings.mcpServers.anvil).toEqual({
      type: 'http',
      url: 'http://localhost:8100/mcp',
    });
    expect(settings.permissions.allow).toContain('mcp__*__*');
  });

  it('preserves existing mcpServers entries', async () => {
    const settingsDir = path.join(tmpDir, '.claude');
    await fs.mkdir(settingsDir, { recursive: true });
    await fs.writeFile(
      path.join(settingsDir, 'settings.local.json'),
      JSON.stringify({
        mcpServers: { existing: { type: 'http', url: 'http://localhost:9999/mcp' } },
      }),
    );

    await updateClaudeMcpServers(
      [{ name: 'anvil', url: 'http://localhost:8100' }],
      tmpDir,
    );

    const raw = await fs.readFile(
      path.join(settingsDir, 'settings.local.json'),
      'utf-8',
    );
    const settings = JSON.parse(raw);

    expect(settings.mcpServers.existing.url).toBe('http://localhost:9999/mcp');
    expect(settings.mcpServers.anvil.url).toBe('http://localhost:8100/mcp');
  });

  it('preserves existing permissions and adds defaults if missing', async () => {
    const settingsDir = path.join(tmpDir, '.claude');
    await fs.mkdir(settingsDir, { recursive: true });
    await fs.writeFile(
      path.join(settingsDir, 'settings.local.json'),
      JSON.stringify({
        permissions: { allow: ['Bash(*)'], deny: ['Bash(rm *)'] },
      }),
    );

    await updateClaudeMcpServers(
      [{ name: 'vault', url: 'http://localhost:8300' }],
      tmpDir,
    );

    const raw = await fs.readFile(
      path.join(settingsDir, 'settings.local.json'),
      'utf-8',
    );
    const settings = JSON.parse(raw);

    expect(settings.permissions.allow).toContain('Bash(*)');
    expect(settings.permissions.allow).toContain('mcp__*__*');
    expect(settings.permissions.deny).toEqual(['Bash(rm *)']);
  });

  it('does not duplicate entries if already present', async () => {
    const settingsDir = path.join(tmpDir, '.claude');
    await fs.mkdir(settingsDir, { recursive: true });
    await fs.writeFile(
      path.join(settingsDir, 'settings.local.json'),
      JSON.stringify({
        permissions: { allow: ['mcp__*__*'] },
      }),
    );

    await updateClaudeMcpServers(
      [{ name: 'anvil', url: 'http://localhost:8100' }],
      tmpDir,
    );

    const raw = await fs.readFile(
      path.join(settingsDir, 'settings.local.json'),
      'utf-8',
    );
    const settings = JSON.parse(raw);

    const count = settings.permissions.allow.filter((x: string) => x === 'mcp__*__*').length;
    expect(count).toBe(1);
  });

  it('skips writing when server list is empty', async () => {
    await updateClaudeMcpServers([], tmpDir);

    const exists = await fs.access(path.join(tmpDir, '.claude', 'settings.local.json'))
      .then(() => true)
      .catch(() => false);

    expect(exists).toBe(false);
  });

  it('writes multiple servers in a single call', async () => {
    await updateClaudeMcpServers(
      [
        { name: 'anvil', url: 'http://localhost:8100' },
        { name: 'vault', url: 'http://localhost:8300' },
        { name: 'forge', url: 'http://localhost:8200' },
      ],
      tmpDir,
    );

    const raw = await fs.readFile(
      path.join(tmpDir, '.claude', 'settings.local.json'),
      'utf-8',
    );
    const settings = JSON.parse(raw);

    expect(Object.keys(settings.mcpServers)).toEqual(['anvil', 'vault', 'forge']);
    expect(settings.permissions.allow).toContain('mcp__*__*');
  });

  it('applies full claude_permissions from config (allow + deny)', async () => {
    await updateClaudeMcpServers(
      [{ name: 'anvil', url: 'http://localhost:8100' }],
      tmpDir,
      undefined,
      {
        allow: ['Bash(*)', 'Edit(*)', 'Write(*)', 'Read(*)', 'mcp__*'],
        deny: ['Bash(rm *)', 'Bash(rmdir *)'],
      },
    );

    const raw = await fs.readFile(
      path.join(tmpDir, '.claude', 'settings.local.json'),
      'utf-8',
    );
    const settings = JSON.parse(raw);

    expect(settings.permissions.allow).toEqual(
      expect.arrayContaining(['Bash(*)', 'Edit(*)', 'Write(*)', 'Read(*)', 'mcp__*']),
    );
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining(['Bash(rm *)', 'Bash(rmdir *)']),
    );
  });

  it('merges config permissions with existing without duplicates', async () => {
    const settingsDir = path.join(tmpDir, '.claude');
    await fs.mkdir(settingsDir, { recursive: true });
    await fs.writeFile(
      path.join(settingsDir, 'settings.local.json'),
      JSON.stringify({
        permissions: { allow: ['Bash(*)', 'mcp__*'], deny: ['Bash(rm *)'] },
      }),
    );

    await updateClaudeMcpServers(
      [{ name: 'anvil', url: 'http://localhost:8100' }],
      tmpDir,
      undefined,
      {
        allow: ['Bash(*)', 'Edit(*)', 'mcp__*'],
        deny: ['Bash(rm *)', 'Bash(rmdir *)'],
      },
    );

    const raw = await fs.readFile(
      path.join(settingsDir, 'settings.local.json'),
      'utf-8',
    );
    const settings = JSON.parse(raw);

    // No duplicates
    const bashCount = settings.permissions.allow.filter((x: string) => x === 'Bash(*)').length;
    expect(bashCount).toBe(1);
    const mcpCount = settings.permissions.allow.filter((x: string) => x === 'mcp__*').length;
    expect(mcpCount).toBe(1);
    const rmCount = settings.permissions.deny.filter((x: string) => x === 'Bash(rm *)').length;
    expect(rmCount).toBe(1);

    // New entries added
    expect(settings.permissions.allow).toContain('Edit(*)');
    expect(settings.permissions.deny).toContain('Bash(rmdir *)');
  });

  it('uses default mcp__*__* when no claudePermissions provided', async () => {
    await updateClaudeMcpServers(
      [{ name: 'anvil', url: 'http://localhost:8100' }],
      tmpDir,
      undefined,
      undefined,
    );

    const raw = await fs.readFile(
      path.join(tmpDir, '.claude', 'settings.local.json'),
      'utf-8',
    );
    const settings = JSON.parse(raw);

    expect(settings.permissions.allow).toEqual(['mcp__*__*']);
    expect(settings.permissions.deny).toBeUndefined();
  });
});

describe('updateClaudeMcpServers — settings.json (project-level shared)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-mcp-shared-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates settings.json with permissions block', async () => {
    await updateClaudeMcpServers(
      [{ name: 'anvil', url: 'http://localhost:8100' }],
      tmpDir,
    );

    const raw = await fs.readFile(
      path.join(tmpDir, '.claude', 'settings.json'),
      'utf-8',
    );
    const settings = JSON.parse(raw);

    expect(settings.permissions.allow).toContain('mcp__*__*');
  });

  it('does not write mcpServers or hooks to settings.json', async () => {
    await updateClaudeMcpServers(
      [{ name: 'anvil', url: 'http://localhost:8100' }],
      tmpDir,
      undefined,
      {
        allow: ['mcp__*__*', 'Bash(*)'],
        deny: ['Bash(rm *)'],
      },
    );

    const raw = await fs.readFile(
      path.join(tmpDir, '.claude', 'settings.json'),
      'utf-8',
    );
    const settings = JSON.parse(raw);

    expect(settings.mcpServers).toBeUndefined();
    expect(settings.hooks).toBeUndefined();
    expect(settings.permissions.allow).toEqual(expect.arrayContaining(['mcp__*__*', 'Bash(*)']));
    expect(settings.permissions.deny).toEqual(['Bash(rm *)']);
  });

  it('merges into existing settings.json without overwriting other keys', async () => {
    const claudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ model: 'sonnet', permissions: { allow: ['Read(*)'] } }),
    );

    await updateClaudeMcpServers(
      [{ name: 'anvil', url: 'http://localhost:8100' }],
      tmpDir,
    );

    const raw = await fs.readFile(path.join(claudeDir, 'settings.json'), 'utf-8');
    const settings = JSON.parse(raw);

    expect(settings.model).toBe('sonnet');
    expect(settings.permissions.allow).toContain('Read(*)');
    expect(settings.permissions.allow).toContain('mcp__*__*');
  });

  it('does not duplicate permissions in settings.json on repeated calls', async () => {
    await updateClaudeMcpServers(
      [{ name: 'anvil', url: 'http://localhost:8100' }],
      tmpDir,
    );
    await updateClaudeMcpServers(
      [{ name: 'anvil', url: 'http://localhost:8100' }],
      tmpDir,
    );

    const raw = await fs.readFile(
      path.join(tmpDir, '.claude', 'settings.json'),
      'utf-8',
    );
    const settings = JSON.parse(raw);

    const count = settings.permissions.allow.filter((x: string) => x === 'mcp__*__*').length;
    expect(count).toBe(1);
  });

  it('skips creating settings.json when server list is empty', async () => {
    await updateClaudeMcpServers([], tmpDir);

    const exists = await fs.access(path.join(tmpDir, '.claude', 'settings.json'))
      .then(() => true)
      .catch(() => false);

    expect(exists).toBe(false);
  });
});

describe('updateCursorMcpServers', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-cursor-mcp-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates .cursor/mcp.json with mcpServers using url-only format', async () => {
    await updateCursorMcpServers(
      [{ name: 'anvil', url: 'http://localhost:8100' }],
      tmpDir,
    );

    const raw = await fs.readFile(
      path.join(tmpDir, '.cursor', 'mcp.json'),
      'utf-8',
    );
    const settings = JSON.parse(raw);

    expect(settings.mcpServers.anvil).toEqual({
      url: 'http://localhost:8100/mcp',
    });
    // Cursor format should NOT have 'type' field
    expect(settings.mcpServers.anvil.type).toBeUndefined();
  });

  it('preserves existing mcpServers entries', async () => {
    const cursorDir = path.join(tmpDir, '.cursor');
    await fs.mkdir(cursorDir, { recursive: true });
    await fs.writeFile(
      path.join(cursorDir, 'mcp.json'),
      JSON.stringify({
        mcpServers: { existing: { url: 'http://localhost:9999/mcp' } },
      }),
    );

    await updateCursorMcpServers(
      [{ name: 'anvil', url: 'http://localhost:8100' }],
      tmpDir,
    );

    const raw = await fs.readFile(
      path.join(cursorDir, 'mcp.json'),
      'utf-8',
    );
    const settings = JSON.parse(raw);

    expect(settings.mcpServers.existing.url).toBe('http://localhost:9999/mcp');
    expect(settings.mcpServers.anvil.url).toBe('http://localhost:8100/mcp');
  });

  it('skips writing when server list is empty', async () => {
    await updateCursorMcpServers([], tmpDir);

    const exists = await fs.access(path.join(tmpDir, '.cursor', 'mcp.json'))
      .then(() => true)
      .catch(() => false);

    expect(exists).toBe(false);
  });

  it('writes multiple servers in a single call', async () => {
    await updateCursorMcpServers(
      [
        { name: 'anvil', url: 'http://localhost:8100' },
        { name: 'vault', url: 'http://localhost:8300' },
        { name: 'forge', url: 'http://localhost:8200' },
      ],
      tmpDir,
    );

    const raw = await fs.readFile(
      path.join(tmpDir, '.cursor', 'mcp.json'),
      'utf-8',
    );
    const settings = JSON.parse(raw);

    expect(Object.keys(settings.mcpServers)).toEqual(['anvil', 'vault', 'forge']);
    // No permissions section in Cursor format
    expect(settings.permissions).toBeUndefined();
  });

  it('does not include permissions (Cursor has no permission model)', async () => {
    await updateCursorMcpServers(
      [{ name: 'anvil', url: 'http://localhost:8100' }],
      tmpDir,
    );

    const raw = await fs.readFile(
      path.join(tmpDir, '.cursor', 'mcp.json'),
      'utf-8',
    );
    const settings = JSON.parse(raw);

    expect(settings.permissions).toBeUndefined();
    expect(settings.hooks).toBeUndefined();
  });
});
