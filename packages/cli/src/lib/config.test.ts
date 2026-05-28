import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  defaultConfig,
  generateEnv,
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
