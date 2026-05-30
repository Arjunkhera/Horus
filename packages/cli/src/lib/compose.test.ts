import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';

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

import {
  installComposeFile,
  generateComposeFile,
  generateTestComposeFile,
  generateStandaloneComposeFile,
  standaloneComposePath,
} from './compose.js';
import type { Config } from './config.js';
import type { StandaloneSlotPorts } from './compose.js';

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
      ui: 8400,
      forge: 8200,
      typesense: 8108,
      neo4j_http: 7474,
      neo4j_bolt: 7687,
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
    control_plane_url: '',
    token_provider: { kind: '', config: '' },
    ai: {
      key: '',
      anthropic_api_key: '',
      model: 'claude-sonnet-4-6',
    },
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

  it('main compose uses the renamed horus-ui service and ghcr.io/.../ui image', () => {
    const config = makeConfig();
    installComposeFile(config);
    const content = readFileSync(join(testDir, 'docker-compose.yml'), 'utf-8');
    expect(content).toContain('horus-ui:');
    expect(content).toContain('ghcr.io/arjunkhera/horus/ui:latest');
    expect(content).not.toContain('ghcr.io/arjunkhera/horus/reader');
    expect(content).not.toMatch(/^\s*reader:/m);
  });

  it('main compose emits only the 4 alpha-local services (no vault/forge)', () => {
    const content = generateComposeFile(makeConfig());
    // present
    expect(content).toContain('anvil:');
    expect(content).toContain('typesense:');
    expect(content).toContain('neo4j:');
    expect(content).toContain('horus-ui:');
    // dropped — remote services live behind the control plane now
    expect(content).not.toContain('vault-router:');
    expect(content).not.toContain('vault-mcp:');
    expect(content).not.toMatch(/^\s*vault-[a-z]+:/m);
    expect(content).not.toMatch(/^\s*forge:/m);
    expect(content).not.toContain('forge-registry:');
    expect(content).not.toContain('ghcr.io/arjunkhera/horus/vault');
    expect(content).not.toContain('ghcr.io/arjunkhera/horus/forge');
  });

  it('horus-ui block has alpha env, providers volume, and no depends_on', () => {
    const content = generateComposeFile(makeConfig());
    expect(content).toContain('HORUS_CONTROL_PLANE_URL');
    expect(content).toContain('TOKEN_PROVIDER_KIND');
    expect(content).toContain('TOKEN_PROVIDER_CONFIG');
    expect(content).toContain('HORUS_ANTHROPIC_API_KEY');
    expect(content).toContain('HORUS_AGENT_MODEL');
    expect(content).toContain('/horus-providers');
    // horus-ui boots first — no depends_on (block runs until the anvil service)
    const uiBlock = content.slice(content.indexOf('horus-ui:'), content.indexOf('anvil:'));
    expect(uiBlock).not.toContain('depends_on');
  });

  it('main compose parses as valid YAML with exactly the 4 alpha services', () => {
    const doc = parseYaml(generateComposeFile(makeConfig()));
    expect(Object.keys(doc.services).sort()).toEqual(
      ['anvil', 'horus-ui', 'neo4j', 'typesense'],
    );
    expect(doc.networks['horus-net']).toBeDefined();
    expect(doc.volumes).toHaveProperty('neo4j-data');
    expect(doc.volumes).toHaveProperty('neo4j-logs');
    expect(doc.services['horus-ui'].depends_on).toBeUndefined();
    expect(doc.services['horus-ui'].image).toBe('ghcr.io/arjunkhera/horus/ui:latest');
  });

  it('never bakes a literal GITHUB_TOKEN into the generated compose (sources from .env)', () => {
    // makeConfig sets github_hosts.default.token = 'test-token'
    const content = generateComposeFile(makeConfig());
    expect(content).not.toContain('test-token');
    // Anvil sources the token by reference from .env, not as a literal value
    expect(content).toMatch(/GITHUB_TOKEN=\$\{GITHUB_TOKEN/);
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

  it('main compose has the alpha-local topology and no test-env refs', () => {
    const config = makeConfig();
    const content = generateComposeFile(config);

    // The main compose file contains only the four alpha-local services
    expect(content).toContain('Horus — Generated Docker Compose');
    expect(content).toContain('anvil:');
    expect(content).toContain('typesense:');
    expect(content).toContain('neo4j:');
    expect(content).toContain('horus-ui:');
    expect(content).toContain('horus-net');

    // Remote services are no longer generated client-side
    expect(content).not.toMatch(/^\s*forge:/m);
    expect(content).not.toContain('vault-router:');

    // Should NOT contain test-env references
    expect(content).not.toContain('TEST_PORT_');
    expect(content).not.toContain('TEST_DATA_PATH');
  });
});

// ── generateStandaloneComposeFile ────────────────────────────────────────────

function makeSlotPorts(base = 9100): StandaloneSlotPorts {
  return {
    anvil:        base,
    vault_svc:    base + 1,
    vault_router: base + 50,
    vault_mcp:    base + 100,
    forge:        base + 150,
    typesense:    base + 8,
    ui:           base + 160,
    neo4j_http:   base + 174,
    neo4j_bolt:   base + 187,
  };
}

describe('generateStandaloneComposeFile', () => {
  const SLOT_DATA = '/tmp/horus-test-slot-0';
  const SLOT = 0;

  it('produces a valid compose file with expected services', () => {
    const config = makeConfig();
    const ports = makeSlotPorts(9100);
    const content = generateStandaloneComposeFile({ config, ports, slotDataPath: SLOT_DATA, slot: SLOT });

    expect(content).toContain('services:');
    expect(content).toContain('anvil:');
    expect(content).toContain('vault-personal:');
    expect(content).toContain('vault-router:');
    expect(content).toContain('vault-mcp:');
    expect(content).toContain('forge:');
    expect(content).toContain('typesense:');
    expect(content).toContain('neo4j:');
  });

  it('uses explicit (hard-coded) port numbers — no ${VAR} port references', () => {
    const config = makeConfig();
    const ports = makeSlotPorts(9100);
    const content = generateStandaloneComposeFile({ config, ports, slotDataPath: SLOT_DATA, slot: SLOT });

    // Anvil port must be the literal number, not a variable
    expect(content).toContain('"9100:8100"');
    expect(content).toContain('"9101:8000"');   // vault_svc
    expect(content).toContain('"9150:8400"');   // vault_router
    expect(content).toContain('"9200:8300"');   // vault_mcp
    expect(content).toContain('"9250:8200"');   // forge
    expect(content).toContain('"9108:8108"');   // typesense
    expect(content).toContain('"9274:7474"');   // neo4j_http
    expect(content).toContain('"9287:7687"');   // neo4j_bolt

    // Must NOT contain compose env-var port syntax (e.g., ${TEST_PORT_ANVIL:-9100})
    expect(content).not.toMatch(/"\$\{[A-Z_]+(?::-\d+)?\}:\d+"/);
  });

  it('uses slotDataPath for all volume bindings — no HORUS_DATA_PATH vars', () => {
    const config = makeConfig();
    const ports = makeSlotPorts(9100);
    const content = generateStandaloneComposeFile({ config, ports, slotDataPath: SLOT_DATA, slot: SLOT });

    // All bind-mounts should reference the slot data path literally
    expect(content).toContain(`${SLOT_DATA}/notes:/data/notes:rw`);
    expect(content).toContain(`${SLOT_DATA}/typesense-data:/data`);
    expect(content).toContain(`${SLOT_DATA}/neo4j-data:/data`);
    expect(content).toContain(`${SLOT_DATA}/registry:/data/registry:rw`);

    // Must not contain HORUS_DATA_PATH or TEST_DATA_PATH variables
    expect(content).not.toContain('HORUS_DATA_PATH');
    expect(content).not.toContain('TEST_DATA_PATH');
  });

  it('uses a distinct project-scoped network name (not horus-net)', () => {
    const config = makeConfig();
    const ports = makeSlotPorts(9100);
    const content = generateStandaloneComposeFile({ config, ports, slotDataPath: SLOT_DATA, slot: SLOT });

    expect(content).toContain('horus-test-0-net:');
    expect(content).not.toContain('horus-net:');
  });

  it('prefixes named volumes with the project name', () => {
    const config = makeConfig();
    const ports = makeSlotPorts(9100);
    const content = generateStandaloneComposeFile({ config, ports, slotDataPath: SLOT_DATA, slot: SLOT });

    // Named volumes must be project-scoped (disjoint from live stack volumes)
    expect(content).toContain('horus-test-0-vault-personal-workspace:');
    // The volumes section must NOT define an unscoped name (i.e., starting a line with
    // just "  vault-personal-workspace:" without the project prefix)
    expect(content).not.toMatch(/^  vault-personal-workspace:/m);
  });

  it('respects --image overrides', () => {
    const config = makeConfig();
    const ports = makeSlotPorts(9100);
    const content = generateStandaloneComposeFile({
      config,
      ports,
      slotDataPath: SLOT_DATA,
      slot: SLOT,
      imageOverrides: { anvil: 'myrepo/anvil:pr-123' },
    });

    expect(content).toContain('image: myrepo/anvil:pr-123');
    // Other services unaffected
    expect(content).toContain('image: ghcr.io/arjunkhera/horus/forge:latest');
  });

  it('slot 1 uses different base ports (no collision with slot 0)', () => {
    const config = makeConfig();
    const ports0 = makeSlotPorts(9100);
    const ports1 = makeSlotPorts(9400);
    const c0 = generateStandaloneComposeFile({ config, ports: ports0, slotDataPath: '/tmp/slot-0', slot: 0 });
    const c1 = generateStandaloneComposeFile({ config, ports: ports1, slotDataPath: '/tmp/slot-1', slot: 1 });

    // Slot 0 must not contain slot 1 ports and vice-versa
    expect(c0).toContain('"9100:8100"');
    expect(c0).not.toContain('"9400:8100"');
    expect(c1).toContain('"9400:8100"');
    expect(c1).not.toContain('"9100:8100"');
  });

  it('does not contain any ${...} env var substitutions in port or volume bindings', () => {
    const config = makeConfig();
    const ports = makeSlotPorts(9100);
    const content = generateStandaloneComposeFile({ config, ports, slotDataPath: SLOT_DATA, slot: SLOT });

    // Extract only ports: and volumes: values — they should be bare strings
    const portLines = content.split('\n').filter((l) => l.trim().startsWith('- "') && l.includes(':'));
    for (const line of portLines) {
      // Port lines like: - "9100:8100" should not contain ${ ... }
      expect(line).not.toMatch(/\$\{/);
    }
  });

  it('standalone file contains isolation invariant comment', () => {
    const config = makeConfig();
    const ports = makeSlotPorts(9100);
    const content = generateStandaloneComposeFile({ config, ports, slotDataPath: SLOT_DATA, slot: SLOT });

    expect(content).toContain('Isolation:');
    expect(content).toContain('horus-test-0');
  });
});

describe('standaloneComposePath', () => {
  it('returns path inside slotDataPath', () => {
    const p = standaloneComposePath('/tmp/slot-0');
    expect(p).toBe('/tmp/slot-0/docker-compose.standalone.yml');
  });
});

// ── Zero-vault regression tests (bug c958777b) ────────────────────────────────
// A fresh/zero-vault config must produce valid YAML with no empty depends_on:
// or volumes: blocks, and must not emit VAULT_ENDPOINTS= with an empty value.

function makeZeroVaultConfig(): Config {
  const cfg = makeConfig();
  return { ...cfg, vaults: {} };
}

describe('generateComposeFile — zero vaults (bug c958777b)', () => {
  it('does not emit VAULT_ENDPOINTS when there are no vaults', () => {
    const content = generateComposeFile(makeZeroVaultConfig());
    expect(content).not.toMatch(/- VAULT_ENDPOINTS=/);
  });

  it('does not emit a bare depends_on: mapping in vault-router', () => {
    const content = generateComposeFile(makeZeroVaultConfig());
    // A bare depends_on: would be immediately followed by another yaml key
    // at the same or lower indentation (networks:, restart:, etc.)
    expect(content).not.toMatch(/depends_on:\s*\n\s{4}networks:/);
    expect(content).not.toMatch(/depends_on:\s*\n\s{4}restart:/);
  });

  it('still emits the neo4j named volumes section', () => {
    const content = generateComposeFile(makeZeroVaultConfig());
    expect(content).toContain('neo4j-data:');
    expect(content).toContain('neo4j-logs:');
  });

  it('produces parseable YAML structure (no bare mappings)', () => {
    const content = generateComposeFile(makeZeroVaultConfig());
    // Ensure no line is just "depends_on:" with nothing indented beneath it
    const lines = content.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].trimEnd() === '    depends_on:') {
        // Next non-empty line must be indented deeper (service name or condition)
        const next = lines.slice(i + 1).find((l) => l.trim() !== '');
        expect(next).toMatch(/^      /);
      }
    }
  });
});

describe('generateStandaloneComposeFile — zero vaults (bug c958777b)', () => {
  const SLOT_DATA = '/tmp/horus-test-slot-0';
  const SLOT = 0;

  it('does not emit VAULT_ENDPOINTS when there are no vaults', () => {
    const content = generateStandaloneComposeFile({
      config: makeZeroVaultConfig(),
      ports: makeSlotPorts(9100),
      slotDataPath: SLOT_DATA,
      slot: SLOT,
    });
    expect(content).not.toMatch(/- VAULT_ENDPOINTS=/);
  });

  it('does not emit a bare depends_on: mapping in vault-router', () => {
    const content = generateStandaloneComposeFile({
      config: makeZeroVaultConfig(),
      ports: makeSlotPorts(9100),
      slotDataPath: SLOT_DATA,
      slot: SLOT,
    });
    expect(content).not.toMatch(/depends_on:\s*\n\s{4}networks:/);
    expect(content).not.toMatch(/depends_on:\s*\n\s{4}restart:/);
  });

  it('omits the top-level volumes: section entirely when no vaults', () => {
    const content = generateStandaloneComposeFile({
      config: makeZeroVaultConfig(),
      ports: makeSlotPorts(9100),
      slotDataPath: SLOT_DATA,
      slot: SLOT,
    });
    // No volumes: key should appear (standalone uses only bind-mounts, no named volumes without vaults)
    expect(content).not.toMatch(/^volumes:/m);
  });

  it('still emits networks: section after dropping volumes:', () => {
    const content = generateStandaloneComposeFile({
      config: makeZeroVaultConfig(),
      ports: makeSlotPorts(9100),
      slotDataPath: SLOT_DATA,
      slot: SLOT,
    });
    expect(content).toContain('networks:');
    expect(content).toContain('horus-test-0-net:');
  });
});
