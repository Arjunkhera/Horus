import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import {
  defaultConfig,
  generateEnv,
  generateForgeConfig,
  writeForgeConfigFile,
  FORGE_CONFIG_MANAGED_MARKER,
  loadPreprovisionedConfig,
  getConfigValue,
  setConfigValue,
} from './config.js';

describe('generateEnv — alpha env vars', () => {
  it('emits control-plane, token-provider, agent, and providers vars', () => {
    const config = defaultConfig();
    config.control_plane_url = 'https://cp.example.com';
    config.token_provider = { kind: 'static', config: 'tok-123' };
    config.ai.anthropic_api_key = 'sk-ant-test';
    config.ai.model = 'claude-sonnet-4-6';
    config.repos.anvil_notes = 'https://github.com/me/notes';

    const env = generateEnv(config);

    expect(env).toContain('HORUS_CONTROL_PLANE_URL=https://cp.example.com');
    expect(env).toContain('TOKEN_PROVIDER_KIND=static');
    expect(env).toContain('TOKEN_PROVIDER_CONFIG=tok-123');
    expect(env).toContain('HORUS_ANTHROPIC_API_KEY=sk-ant-test');
    expect(env).toContain('HORUS_AGENT_MODEL=claude-sonnet-4-6');
    expect(env).toMatch(/HORUS_PROVIDERS_PATH=.+\/providers/);
    expect(env).toContain('ANVIL_REPO_URL=https://github.com/me/notes');
  });

  it('local-only: empty control-plane url is emitted (mode is config-driven)', () => {
    const env = generateEnv(defaultConfig());
    expect(env).toContain('HORUS_CONTROL_PLANE_URL=');
  });
});

describe('generateForgeConfig — embedded Forge registry wiring', () => {
  it('connected: points local AND global registries at the control-plane Forge registry', () => {
    const config = defaultConfig();
    config.control_plane_url = 'https://cp.example.com';
    const doc = parseYaml(generateForgeConfig(config));
    const byName = Object.fromEntries(doc.registries.map((r: any) => [r.name, r]));
    expect(byName.local.url).toBe('https://cp.example.com/api/v1/forge');
    expect(byName.global.url).toBe('https://cp.example.com/api/v1/forge');
    // tokenEnv lets the engine authenticate; both names present so @forge/core
    // does NOT re-inject its hardcoded localhost:8744 / CloudFront defaults.
    expect(byName.local.tokenEnv).toBe('TOKEN_PROVIDER_CONFIG');
    expect(byName.local.writable).toBe(true);
    expect(byName.global.writable).toBe(false);
  });

  it('connected: never emits the dead default registries', () => {
    const config = defaultConfig();
    config.control_plane_url = 'https://cp.example.com';
    const yaml = generateForgeConfig(config);
    expect(yaml).not.toContain('cloudfront');
    expect(yaml).not.toContain('localhost:8744');
  });

  it('strips a trailing slash on the control-plane url', () => {
    const config = defaultConfig();
    config.control_plane_url = 'https://cp.example.com/';
    const doc = parseYaml(generateForgeConfig(config));
    expect(doc.registries[0].url).toBe('https://cp.example.com/api/v1/forge');
  });

  it('local-only: avoids the dead CloudFront host (no remote registry available)', () => {
    const config = defaultConfig();
    config.control_plane_url = '';
    const yaml = generateForgeConfig(config);
    expect(yaml).not.toContain('cloudfront');
    const doc = parseYaml(yaml);
    expect(doc.registries.every((r: any) => r.url === 'http://localhost:8744')).toBe(true);
  });

  it('emits container workspace paths + host paths and the anvil MCP endpoint', () => {
    const config = defaultConfig();
    config.data_dir = '/home/me/Horus/data';
    config.control_plane_url = 'https://cp.example.com';
    const doc = parseYaml(generateForgeConfig(config));
    expect(doc.workspace.mount_path).toBe('/horus/workspaces');
    expect(doc.workspace.host_workspaces_path).toBe('/home/me/Horus/data/workspaces');
    expect(doc.workspace.host_managed_repos_path).toBe('/home/me/Horus/data/repos');
    expect(doc.mcp_endpoints.anvil.url).toBe('http://anvil:8100');
    expect(doc.repos.scan_paths).toContain('/horus/repos');
  });
});

describe('writeForgeConfigFile — idempotent, non-destructive', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'forgecfg-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes forge.yaml under <data_dir>/config and reports written', () => {
    const config = defaultConfig();
    config.data_dir = dir;
    config.control_plane_url = 'https://cp.example.com';
    const res = writeForgeConfigFile(config);
    expect(res.written).toBe(true);
    expect(res.path).toBe(join(dir, 'config', 'forge.yaml'));
    expect(existsSync(res.path)).toBe(true);
    expect(readFileSync(res.path, 'utf-8')).toContain(FORGE_CONFIG_MANAGED_MARKER);
  });

  it('regenerates a previously CLI-managed file', () => {
    const config = defaultConfig();
    config.data_dir = dir;
    config.control_plane_url = 'https://cp.example.com';
    writeForgeConfigFile(config);
    const res2 = writeForgeConfigFile(config);
    expect(res2.written).toBe(true);
  });

  it('leaves a hand-managed file (marker removed) untouched', () => {
    const config = defaultConfig();
    config.data_dir = dir;
    config.control_plane_url = 'https://cp.example.com';
    const res = writeForgeConfigFile(config);
    const handEdited = 'registries: []\n# user owns this file\n';
    writeFileSync(res.path, handEdited);
    const res2 = writeForgeConfigFile(config);
    expect(res2.written).toBe(false);
    expect(readFileSync(res.path, 'utf-8')).toBe(handEdited);
  });
});

describe('loadPreprovisionedConfig — zod validation', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'horus-preprov-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a valid bundle and merges over defaults', () => {
    const path = join(dir, 'config.yaml.preprovisioned');
    writeFileSync(
      path,
      [
        'runtime: docker',
        'control_plane_url: https://cp.example.com',
        'token_provider:',
        '  kind: oidc',
        '  config: https://issuer.example.com',
      ].join('\n'),
    );
    const config = loadPreprovisionedConfig(path);
    expect(config.control_plane_url).toBe('https://cp.example.com');
    expect(config.token_provider?.kind).toBe('oidc');
    // defaults are filled for unspecified fields
    expect(config.ports.anvil).toBe(8100);
  });

  it('rejects an invalid runtime value', () => {
    const path = join(dir, 'config.yaml.preprovisioned');
    writeFileSync(path, 'runtime: kubernetes\n');
    expect(() => loadPreprovisionedConfig(path)).toThrow(/validation/i);
  });

  it('throws when the file is missing', () => {
    expect(() => loadPreprovisionedConfig(join(dir, 'nope.yaml'))).toThrow(/not found/i);
  });
});

describe('config get/set — alpha keys', () => {
  it('round-trips control-plane-url, token provider, and agent model', () => {
    let config = defaultConfig();
    config = setConfigValue(config, 'control-plane-url', 'https://cp.example.com');
    config = setConfigValue(config, 'token-provider-kind', 'static');
    config = setConfigValue(config, 'token-provider-config', 'tok-9');
    config = setConfigValue(config, 'ai.model', 'claude-opus-4-7');

    expect(getConfigValue(config, 'control-plane-url')).toBe('https://cp.example.com');
    expect(getConfigValue(config, 'token-provider-kind')).toBe('static');
    expect(getConfigValue(config, 'token-provider-config')).toBe('tok-9');
    expect(getConfigValue(config, 'ai.model')).toBe('claude-opus-4-7');
  });
});
