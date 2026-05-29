import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBundle, serializeBundle } from './bundle.js';
import { loadPreprovisionedConfig } from './config.js';

describe('pre-provisioned bundle', () => {
  it('builds the schema shape with the token as the static provider config', () => {
    const bundle = buildBundle({
      controlPlaneUrl: 'https://cp.example.com',
      initialToken: 'TKN123',
      vaults: [{ namespace: 'acme/notes', endpoint: 'http://vault-router/vaults/acme/notes', default: true }],
    });
    expect(bundle.version).toBe('1');
    expect(bundle.control_plane_url).toBe('https://cp.example.com');
    expect(bundle.token_provider).toEqual({ kind: 'static', config: 'TKN123' });
    expect(bundle.vaults['acme/notes']).toEqual({
      endpoint: 'http://vault-router/vaults/acme/notes',
      default: true,
    });
  });

  it('CONTRACT: serialized YAML is consumable by the client loadPreprovisionedConfig', () => {
    const yaml = serializeBundle(
      buildBundle({
        controlPlaneUrl: 'https://cp.example.com',
        initialToken: 'TKN123',
        vaults: [{ namespace: 'acme/notes', endpoint: 'http://v' }],
      }),
    );
    const dir = mkdtempSync(join(tmpdir(), 'horus-bundle-'));
    const path = join(dir, 'user.bundle.yaml');
    writeFileSync(path, yaml, 'utf8');
    try {
      const config = loadPreprovisionedConfig(path); // must not throw
      expect(config.token_provider?.kind).toBe('static');
      expect(config.token_provider?.config).toBe('TKN123');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
