import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock execa before importing the module under test
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

// Mock node:fs and node:os to avoid touching the real filesystem
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/home/testuser'),
}));

vi.mock('../lib/config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../lib/runtime.js', () => ({
  detectRuntime: vi.fn(),
}));

import { execa } from 'execa';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import {
  isClaudeCliAvailable,
  registerWithClaudeCode,
  buildStdioServers,
  getMcpRemoteWrapperPath,
  mergeAndWriteConfig,
} from './connect.js';

const mockExistsSync = vi.mocked(existsSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);

const mockExeca = vi.mocked(execa);

function makeResult(exitCode: number, stdout = '', stderr = '') {
  return { exitCode, stdout, stderr } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── isClaudeCliAvailable ──────────────────────────────────────────────────────

describe('isClaudeCliAvailable', () => {
  it('returns true when claude --version exits 0', async () => {
    mockExeca.mockResolvedValueOnce(makeResult(0, 'Claude 1.0.0'));
    const result = await isClaudeCliAvailable();
    expect(result).toBe(true);
    expect(mockExeca).toHaveBeenCalledWith('claude', ['--version'], { reject: false });
  });

  it('returns false when claude --version exits non-zero', async () => {
    mockExeca.mockResolvedValueOnce(makeResult(1));
    const result = await isClaudeCliAvailable();
    expect(result).toBe(false);
  });

  it('returns false when claude binary is not on PATH (ENOENT)', async () => {
    mockExeca.mockRejectedValueOnce(
      Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }),
    );
    const result = await isClaudeCliAvailable();
    expect(result).toBe(false);
  });
});

// ── registerWithClaudeCode ────────────────────────────────────────────────────

describe('registerWithClaudeCode', () => {
  const servers = {
    anvil: { url: 'http://localhost:8100/sse' },
    vault: { url: 'http://localhost:8300/sse' },
    forge: { url: 'http://localhost:8200/sse' },
  };

  it('calls claude mcp remove then add for each server', async () => {
    mockExeca.mockResolvedValue(makeResult(0));

    await registerWithClaudeCode(servers);

    // 3 removes + 3 adds = 6 calls total
    expect(mockExeca).toHaveBeenCalledTimes(6);
    expect(mockExeca).toHaveBeenCalledWith(
      'claude',
      ['mcp', 'remove', '--scope', 'user', 'anvil'],
      { reject: false },
    );
    expect(mockExeca).toHaveBeenCalledWith(
      'claude',
      ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'anvil', 'http://localhost:8100'],
      { reject: false },
    );
    expect(mockExeca).toHaveBeenCalledWith(
      'claude',
      ['mcp', 'remove', '--scope', 'user', 'vault'],
      { reject: false },
    );
    expect(mockExeca).toHaveBeenCalledWith(
      'claude',
      ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'vault', 'http://localhost:8300'],
      { reject: false },
    );
    expect(mockExeca).toHaveBeenCalledWith(
      'claude',
      ['mcp', 'remove', '--scope', 'user', 'forge'],
      { reject: false },
    );
    expect(mockExeca).toHaveBeenCalledWith(
      'claude',
      ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'forge', 'http://localhost:8200'],
      { reject: false },
    );
  });

  it('strips /sse suffix from URL before passing to claude mcp add', async () => {
    mockExeca.mockResolvedValue(makeResult(0));
    await registerWithClaudeCode({ anvil: { url: 'http://localhost:8100/sse' } });

    // second call is the add (first is remove)
    expect(mockExeca).toHaveBeenNthCalledWith(
      2,
      'claude',
      ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'anvil', 'http://localhost:8100'],
      { reject: false },
    );
  });

  it('returns all names in registered when all succeed', async () => {
    mockExeca.mockResolvedValue(makeResult(0));
    const { registered, failed } = await registerWithClaudeCode(servers);
    expect(registered).toEqual(expect.arrayContaining(['anvil', 'vault', 'forge']));
    expect(failed).toHaveLength(0);
  });

  it('returns failed names when claude mcp add exits non-zero', async () => {
    mockExeca
      .mockResolvedValueOnce(makeResult(0))  // remove anvil (ok)
      .mockResolvedValueOnce(makeResult(0))  // add anvil (ok)
      .mockResolvedValueOnce(makeResult(0))  // remove vault (ok)
      .mockResolvedValueOnce(makeResult(1))  // add vault (fail)
      .mockResolvedValueOnce(makeResult(0))  // remove forge (ok)
      .mockResolvedValueOnce(makeResult(0)); // add forge (ok)

    const { registered, failed } = await registerWithClaudeCode(servers);
    expect(registered).toContain('anvil');
    expect(registered).toContain('forge');
    expect(failed).toContain('vault');
    expect(failed).toHaveLength(1);
  });

  it('succeeds even when remove exits non-zero (server did not exist yet)', async () => {
    mockExeca
      .mockResolvedValueOnce(makeResult(1))  // remove anvil (server not found — ignored)
      .mockResolvedValueOnce(makeResult(0))  // add anvil (ok)
      .mockResolvedValueOnce(makeResult(1))  // remove vault (server not found — ignored)
      .mockResolvedValueOnce(makeResult(0))  // add vault (ok)
      .mockResolvedValueOnce(makeResult(1))  // remove forge (server not found — ignored)
      .mockResolvedValueOnce(makeResult(0)); // add forge (ok)

    const { registered, failed } = await registerWithClaudeCode(servers);
    expect(registered).toEqual(expect.arrayContaining(['anvil', 'vault', 'forge']));
    expect(failed).toHaveLength(0);
  });

  it('returns all names in failed when all add calls fail', async () => {
    mockExeca
      .mockResolvedValueOnce(makeResult(0))  // remove anvil
      .mockResolvedValueOnce(makeResult(1))  // add anvil (fail)
      .mockResolvedValueOnce(makeResult(0))  // remove vault
      .mockResolvedValueOnce(makeResult(1))  // add vault (fail)
      .mockResolvedValueOnce(makeResult(0))  // remove forge
      .mockResolvedValueOnce(makeResult(1)); // add forge (fail)

    const { registered, failed } = await registerWithClaudeCode(servers);
    expect(registered).toHaveLength(0);
    expect(failed).toEqual(expect.arrayContaining(['anvil', 'vault', 'forge']));
  });

  it('does not include /sse in the URL for servers that already lack it', async () => {
    mockExeca.mockResolvedValue(makeResult(0));
    await registerWithClaudeCode({ anvil: { url: 'http://localhost:8100' } });

    // second call is the add (first is remove)
    expect(mockExeca).toHaveBeenNthCalledWith(
      2,
      'claude',
      ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'anvil', 'http://localhost:8100'],
      { reject: false },
    );
  });
});

// ── getMcpRemoteWrapperPath ─────────────────────────────────────────────────

describe('getMcpRemoteWrapperPath', () => {
  it('returns ~/.forge/bin/mcp-remote-wrapper', () => {
    const path = getMcpRemoteWrapperPath();
    expect(path).toBe('/home/testuser/.forge/bin/mcp-remote-wrapper');
  });
});

// ── buildStdioServers ───────────────────────────────────────────────────────

describe('buildStdioServers', () => {
  const config = {
    ports: { anvil: 8100, vault_mcp: 8300, forge: 8200 },
  } as any;

  it('builds stdio entries with command and args using /mcp endpoint', () => {
    const servers = buildStdioServers(config, '/usr/local/bin/mcp-remote-wrapper', 'localhost');

    expect(servers.anvil).toEqual({
      command: '/usr/local/bin/mcp-remote-wrapper',
      args: ['http://localhost:8100/mcp'],
    });
    expect(servers.vault).toEqual({
      command: '/usr/local/bin/mcp-remote-wrapper',
      args: ['http://localhost:8300/mcp'],
    });
    expect(servers.forge).toEqual({
      command: '/usr/local/bin/mcp-remote-wrapper',
      args: ['http://localhost:8200/mcp'],
    });
  });

  it('uses /mcp endpoint, not /sse', () => {
    const servers = buildStdioServers(config, '/wrapper', 'localhost');
    for (const entry of Object.values(servers)) {
      expect(entry.args[0]).toMatch(/\/mcp$/);
      expect(entry.args[0]).not.toMatch(/\/sse$/);
    }
  });

  it('respects custom host', () => {
    const servers = buildStdioServers(config, '/wrapper', '192.168.1.10');
    expect(servers.anvil.args[0]).toBe('http://192.168.1.10:8100/mcp');
  });
});

// ── mergeAndWriteConfig (Claude Desktop format) ─────────────────────────────

describe('mergeAndWriteConfig with stdio entries', () => {
  const configPath = '/home/testuser/Library/Application Support/Claude/claude_desktop_config.json';

  it('writes command + args format for Claude Desktop', () => {
    mockExistsSync.mockReturnValue(false);

    const stdioServers = {
      anvil: { command: '/wrapper', args: ['http://localhost:8100/mcp'] },
      vault: { command: '/wrapper', args: ['http://localhost:8300/mcp'] },
      forge: { command: '/wrapper', args: ['http://localhost:8200/mcp'] },
    };

    mergeAndWriteConfig(configPath, stdioServers);

    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(written.mcpServers.anvil).toEqual({
      command: '/wrapper',
      args: ['http://localhost:8100/mcp'],
    });
    expect(written.mcpServers.vault).toEqual({
      command: '/wrapper',
      args: ['http://localhost:8300/mcp'],
    });
    expect(written.mcpServers.forge).toEqual({
      command: '/wrapper',
      args: ['http://localhost:8200/mcp'],
    });
  });

  it('preserves existing non-mcpServers keys', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      preferences: { coworkWebSearchEnabled: true },
    }));

    mergeAndWriteConfig(configPath, {
      anvil: { command: '/wrapper', args: ['http://localhost:8100/mcp'] },
    });

    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(written.preferences).toEqual({ coworkWebSearchEnabled: true });
    expect(written.mcpServers.anvil.command).toBe('/wrapper');
  });

  it('merges with existing mcpServers without overwriting unrelated entries', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      mcpServers: {
        custom: { command: '/other', args: [] },
      },
    }));

    mergeAndWriteConfig(configPath, {
      anvil: { command: '/wrapper', args: ['http://localhost:8100/mcp'] },
    });

    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(written.mcpServers.custom).toEqual({ command: '/other', args: [] });
    expect(written.mcpServers.anvil.command).toBe('/wrapper');
  });
});
