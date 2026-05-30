import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted runs before vi.mock hoisting, so the spies exist when the mock
// factory is evaluated.
const h = vi.hoisted(() => {
  const loadedConfig = {
    version: '1.0',
    data_dir: '/tmp/test-data',
    runtime: 'docker',
    vaults: {},
    github_hosts: {},
  } as any;
  return {
    loadedConfig,
    installComposeFile: vi.fn(),
    saveConfig: vi.fn(),
    writeEnvFile: vi.fn(),
    setConfigValue: vi.fn((c: any) => c),
  };
});

vi.mock('../lib/config.js', () => ({
  configExists: () => true,
  loadConfig: () => h.loadedConfig,
  saveConfig: h.saveConfig,
  writeEnvFile: h.writeEnvFile,
  setConfigValue: h.setConfigValue,
  getConfigValue: () => '',
  maskApiKey: (s: string) => s,
  CONFIG_KEYS: ['runtime', 'data-dir'],
}));

vi.mock('../lib/compose.js', () => ({
  installComposeFile: h.installComposeFile,
}));

import { configCommand } from './config.js';

describe('horus config set', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('regenerates docker-compose.yml after updating config (no desync)', async () => {
    await configCommand.parseAsync(['set', 'runtime', 'docker'], { from: 'user' });

    expect(h.saveConfig).toHaveBeenCalledOnce();
    expect(h.writeEnvFile).toHaveBeenCalledOnce();
    // The fix: config set must regenerate the compose file so the running
    // stack and the on-disk compose never silently drift.
    expect(h.installComposeFile).toHaveBeenCalledOnce();
  });
});
