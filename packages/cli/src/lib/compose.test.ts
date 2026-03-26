import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// vi.hoisted runs before vi.mock hoisting, so testDir is available
const { testDir } = vi.hoisted(() => {
  const { join } = require('node:path');
  const { tmpdir } = require('node:os');
  return {
    testDir: join(tmpdir(), `horus-compose-test-${Date.now()}-${Math.random().toString(36).slice(2)}`),
  };
});

vi.mock('./constants.js', () => ({
  COMPOSE_PATH: join(testDir, 'docker-compose.yml'),
  COMPOSE_TEST_PATH: join(testDir, 'docker-compose.test.yml'),
}));

vi.mock('./config.js', () => ({
  ensureHorusDir: () => {
    const { mkdirSync } = require('node:fs');
    mkdirSync(testDir, { recursive: true });
  },
  resolveGitHubHost: () => ({ host: 'github.com', token: 'test-token' }),
}));

import { installComposeFile, generateComposeFile, generateTestComposeFile } from './compose.js';
import type { Config } from './config.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeConfig(): Config {
  return {
    version: '1.0',
    data_dir: '/tmp/test-data',
    host_repos_path: '/tmp/repos',
    host_repos_extra_scan_dirs: [],
    runtime: 'docker',
    ports: {
      anvil: 8100,
      vault_rest: 8000,
      vault_mcp: 8300,
      vault_router: 8050,
      forge: 8200,
      typesense: 8108,
    },
    repos: {
      anvil_notes: 'https://github.com/test/notes',
      forge_registry: 'https://github.com/test/registry',
    },
    search: {
      api_key: 'test-key',
    },
    vaults: {
      personal: {
        repo: 'https://github.com/test/vault',
        default: true,
      },
    },
    github_hosts: {
      default: { host: 'github.com', token: 'test-token' },
    },
    enable_ui: true,
  } as Config;
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('installComposeFile', () => {
  it('writes docker-compose.yml to the target directory', () => {
    const config = makeConfig();
    installComposeFile(config);
    const composePath = join(testDir, 'docker-compose.yml');
    expect(existsSync(composePath)).toBe(true);
    const content = readFileSync(composePath, 'utf-8');
    expect(content).toContain('services:');
    expect(content).toContain('anvil:');
  });

  it('writes docker-compose.test.yml to the target directory', () => {
    const config = makeConfig();
    installComposeFile(config);
    const testComposePath = join(testDir, 'docker-compose.test.yml');
    expect(existsSync(testComposePath)).toBe(true);
  });

  it('test compose file contains expected service overrides', () => {
    const config = makeConfig();
    installComposeFile(config);
    const testComposePath = join(testDir, 'docker-compose.test.yml');
    const content = readFileSync(testComposePath, 'utf-8');

    // Verify key service overrides are present
    expect(content).toContain('services:');
    expect(content).toContain('anvil:');
    expect(content).toContain('vault-personal:');
    expect(content).toContain('vault-router:');
    expect(content).toContain('vault-mcp:');
    expect(content).toContain('forge:');
    expect(content).toContain('typesense:');
    expect(content).toContain('horus-ui:');
  });

  it('test compose file uses TEST_PORT_* env vars for port remapping', () => {
    const config = makeConfig();
    installComposeFile(config);
    const testComposePath = join(testDir, 'docker-compose.test.yml');
    const content = readFileSync(testComposePath, 'utf-8');

    expect(content).toContain('TEST_PORT_ANVIL');
    expect(content).toContain('TEST_PORT_VAULT_SVC');
    expect(content).toContain('TEST_PORT_VAULT_ROUTER');
    expect(content).toContain('TEST_PORT_VAULT_MCP');
    expect(content).toContain('TEST_PORT_FORGE');
    expect(content).toContain('TEST_PORT_TYPESENSE');
    expect(content).toContain('TEST_PORT_UI');
  });

  it('test compose file uses TEST_DATA_PATH for volume remapping', () => {
    const config = makeConfig();
    installComposeFile(config);
    const testComposePath = join(testDir, 'docker-compose.test.yml');
    const content = readFileSync(testComposePath, 'utf-8');

    expect(content).toContain('TEST_DATA_PATH');
  });

  it('test compose content has no JS template literal artifacts', () => {
    const config = makeConfig();
    installComposeFile(config);
    const testComposePath = join(testDir, 'docker-compose.test.yml');
    const content = readFileSync(testComposePath, 'utf-8');

    // Should not contain escaped backticks or escaped dollar signs
    expect(content).not.toContain('\\`');
    expect(content).not.toContain('\\$');
    // Dollar signs should only appear inside ${...} patterns (compose env var syntax)
    const dollarSigns = content.match(/\$/g) || [];
    const dollarBraces = content.match(/\$\{/g) || [];
    expect(dollarSigns.length).toBe(dollarBraces.length);
  });

  it('test compose vault service name matches config', () => {
    const config = makeConfig();
    // Default config uses vault name "personal"
    const personalContent = generateTestComposeFile(config);
    expect(personalContent).toContain('vault-personal:');
    expect(personalContent).toContain('vaults/personal:');
    expect(personalContent).not.toContain('vault-default:');

    // Config with vault name "default" should produce "vault-default"
    const altConfig = { ...config, vaults: { default: { repo: '', default: true } } };
    const defaultContent = generateTestComposeFile(altConfig);
    expect(defaultContent).toContain('vault-default:');
    expect(defaultContent).toContain('vaults/default:');
    expect(defaultContent).not.toContain('vault-personal:');
  });

  it('does not alter main compose file generation', () => {
    const config = makeConfig();
    const content = generateComposeFile(config);

    // The main compose file should contain the dynamically generated services
    expect(content).toContain('Horus — Generated Docker Compose');
    expect(content).toContain('anvil:');
    expect(content).toContain('vault-personal:');
    expect(content).toContain('vault-router:');
    expect(content).toContain('forge:');
    expect(content).toContain('typesense:');
    expect(content).toContain('horus-net');

    // Should NOT contain test-env references
    expect(content).not.toContain('TEST_PORT_');
    expect(content).not.toContain('TEST_DATA_PATH');
  });
});
