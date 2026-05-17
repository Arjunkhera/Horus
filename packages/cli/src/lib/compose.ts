import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { COMPOSE_PATH, COMPOSE_TEST_PATH } from './constants.js';
import { ensureHorusDir, resolveGitHubHost, type Config } from './config.js';

// ── Podman rootless compatibility ────────────────────────────────────────────

/**
 * Podman rootless on macOS uses a Linux VM with virtiofs volume sharing.
 * Host-mounted directories appear as root:nogroup inside the container, so
 * non-root service users (forge, anvil, appuser) get EACCES on write.
 *
 * The fix: override every service to run as root (UID 0) inside the container.
 * In rootless Podman this is safe — "root" in the container maps to the
 * unprivileged host user via user-namespace remapping, so the security
 * boundary is preserved.
 *
 * Inserts `user: "0:0"` after each `image:` line in the compose YAML.
 */
function applyPodmanUserOverride(compose: string): string {
  return compose.replace(
    /^(    image: .+)$/gm,
    '$1\n    user: "0:0"',
  );
}

// ── Static service definitions ───────────────────────────────────────────────

const ANVIL_SERVICE = `\
  # ── Anvil ──────────────────────────────────────────────────────────────────
  # Notes system and MCP server. Indexes markdown files from the Notes repo.
  anvil:
    image: ghcr.io/arjunkhera/horus/anvil:latest
    ports:
      - "\${ANVIL_PORT:-8100}:8100"
    volumes:
      - \${HORUS_DATA_PATH}/notes:/data/notes:rw
    environment:
      - HORUS_RUNTIME=\${HORUS_RUNTIME:-docker}
      - ANVIL_TRANSPORT=http
      - ANVIL_PORT=8100
      - ANVIL_HOST=0.0.0.0
      - ANVIL_NOTES_PATH=/data/notes
      - ANVIL_REPO_URL=\${ANVIL_REPO_URL:-}
      - ANVIL_SYNC_INTERVAL=\${ANVIL_SYNC_INTERVAL:-300}
      - ANVIL_DEBOUNCE_SECONDS=\${ANVIL_DEBOUNCE_SECONDS:-5}
      - GITHUB_TOKEN=\${GITHUB_TOKEN:-}
      - TYPESENSE_HOST=typesense
      - TYPESENSE_PORT=8108
      - TYPESENSE_API_KEY=\${TYPESENSE_API_KEY:-horus-local-key}
      - NEO4J_URI=bolt://neo4j:7687
      - NEO4J_USER=neo4j
      - NEO4J_PASSWORD=horus-neo4j
    depends_on:
      typesense:
        condition: service_healthy
      neo4j:
        condition: service_healthy
    networks:
      - horus-net
    restart: unless-stopped
    stop_grace_period: 15s
    deploy:
      resources:
        limits:
          memory: 512m
        reservations:
          memory: 256m
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8100/health"]
      interval: 30s
      timeout: 5s
      start_period: 60s
      retries: 3`;

const FORGE_SERVICE = `\
  # ── Forge ──────────────────────────────────────────────────────────────────
  # Workspace manager and package registry MCP server.
  forge:
    image: ghcr.io/arjunkhera/horus/forge:latest
    ports:
      - "\${FORGE_PORT:-8200}:8200"
    volumes:
      - \${HORUS_DATA_PATH}/config:/data/config:rw
      - \${HORUS_DATA_PATH}/registry:/data/registry:rw
      - \${HORUS_DATA_PATH}/workspaces:/data/workspaces:rw
      - \${HORUS_DATA_PATH}/repos:/data/horus-repos:rw
      - \${HORUS_DATA_PATH}/sessions:/data/sessions:rw
      - \${HOST_REPOS_PATH}:/data/repos:ro
    environment:
      - HORUS_RUNTIME=\${HORUS_RUNTIME:-docker}
      - FORGE_PORT=8200
      - FORGE_HOST=0.0.0.0
      - FORGE_REGISTRY_PATH=/data/registry
      - FORGE_WORKSPACES_PATH=/data/workspaces
      - FORGE_CONFIG_PATH=/data/config
      - FORGE_MANAGED_REPOS_PATH=/data/horus-repos
      - FORGE_REGISTRY_REPO_URL=\${FORGE_REGISTRY_REPO_URL:-}
      - FORGE_SYNC_INTERVAL=\${FORGE_SYNC_INTERVAL:-300}
      - FORGE_ANVIL_URL=http://anvil:8100
      - FORGE_VAULT_URL=http://vault-mcp:8300
      - FORGE_HOST_WORKSPACES_PATH=\${HORUS_DATA_PATH}/workspaces
      - FORGE_HOST_MANAGED_REPOS_PATH=\${HORUS_DATA_PATH}/repos
      - FORGE_HOST_REPOS_PATH=\${HOST_REPOS_PATH}
      - FORGE_HOST_MANAGED_REPOS_PATH=\${HORUS_DATA_PATH}/repos
      - FORGE_HOST_ANVIL_URL=http://localhost:\${ANVIL_PORT:-8100}
      - FORGE_HOST_VAULT_URL=http://localhost:\${VAULT_MCP_PORT:-8300}
      - FORGE_HOST_FORGE_URL=http://localhost:\${FORGE_PORT:-8200}
      - FORGE_SCAN_PATHS=\${FORGE_SCAN_PATHS:-/data/repos}
      - FORGE_SESSION_TTL_MS=\${FORGE_SESSION_TTL_MS:-1800000}
      - GITHUB_TOKEN=\${GITHUB_TOKEN:-}
      - TYPESENSE_HOST=typesense
      - TYPESENSE_PORT=8108
      - TYPESENSE_API_KEY=\${TYPESENSE_API_KEY:-horus-local-key}
    depends_on:
      anvil:
        condition: service_healthy
      typesense:
        condition: service_healthy
      vault-router:
        condition: service_healthy
    networks:
      - horus-net
    restart: unless-stopped
    stop_grace_period: 15s
    deploy:
      resources:
        limits:
          memory: 512m
        reservations:
          memory: 128m
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8200/health"]
      interval: 30s
      timeout: 5s
      start_period: 60s
      retries: 3`;


const NEO4J_SERVICE = `\
  # ── Neo4j ─────────────────────────────────────────────────────────────────
  # Graph database for relationship-aware knowledge queries.
  neo4j:
    image: neo4j:5-community
    ports:
      - "\${NEO4J_HTTP_PORT:-7474}:7474"
      - "\${NEO4J_BOLT_PORT:-7687}:7687"
    volumes:
      - neo4j-data:/data
      - neo4j-logs:/logs
    environment:
      - NEO4J_AUTH=neo4j/horus-neo4j
      - NEO4J_server_memory_heap_initial__size=256m
      - NEO4J_server_memory_heap_max__size=512m
      - NEO4J_server_memory_pagecache_size=256m
      - NEO4J_PLUGINS=[]
    networks:
      - horus-net
    restart: unless-stopped
    stop_grace_period: 30s
    deploy:
      resources:
        limits:
          memory: 1g
        reservations:
          memory: 512m
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:7474"]
      interval: 30s
      timeout: 10s
      start_period: 60s
      retries: 3`;

const TYPESENSE_SERVICE = `\
  # ── Typesense ────────────────────────────────────────────────────────────
  # Full-text and vector search engine for unified Horus Search.
  typesense:
    image: typesense/typesense:27.1
    ports:
      - "\${TYPESENSE_PORT:-8108}:8108"
    volumes:
      - \${HORUS_DATA_PATH}/typesense-data:/data
    command: >
      --data-dir=/data
      --api-key=\${TYPESENSE_API_KEY:-horus-local-key}
      --enable-cors
    networks:
      - horus-net
    healthcheck:
      test: ["CMD-SHELL", "bash -c 'echo > /dev/tcp/localhost/8108'"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 5s
    restart: unless-stopped`;

const READER_SERVICE = `\
  # ── Reader ─────────────────────────────────────────────────────────────────
  # Horus Reader — Express server + NLP agent search at port 8400.
  # Serves Reader SPA, proxies /api/* to Anvil, hosts POST /api/ai/ask.
  reader:
    image: ghcr.io/arjunkhera/horus/reader:latest
    ports:
      - "\${UI_PORT:-8400}:8400"
    environment:
      - CURSOR_API_KEY=\${HORUS_AI_KEY}
      - HORUS_AGENT_MODEL=\${HORUS_AGENT_MODEL:-composer-2}
      - ANVIL_HOST=anvil
      - ANVIL_PORT=8100
    depends_on:
      anvil:
        condition: service_healthy
    networks:
      - horus-net
    restart: unless-stopped
    stop_grace_period: 15s
    deploy:
      resources:
        limits:
          memory: 256m
        reservations:
          memory: 128m
    healthcheck:
      test: ["CMD-SHELL", "wget -qO /dev/null http://localhost:8400/health"]
      interval: 30s
      timeout: 5s
      start_period: 20s
      retries: 3`;

// ── Test compose overlay generation ──────────────────────────────────────────

/**
 * Generate Docker Compose override for integration testing (shadow stack).
 * Remaps ports and volumes to per-slot test values via TEST_PORT_* and
 * TEST_DATA_PATH env vars set by `horus test-env acquire`.
 *
 * The vault service name is read from config so it matches the dynamically
 * generated base compose file.
 */
export function generateTestComposeFile(config: Config): string {
  const vaultEntries = Object.entries(config.vaults).sort(([a], [b]) => a.localeCompare(b));
  const defaultVaultEntry = vaultEntries.find(([, v]) => v.default);
  const vaultName = defaultVaultEntry ? defaultVaultEntry[0] : (vaultEntries[0]?.[0] ?? 'default');

  return `# ─────────────────────────────────────────────────────────────────────────────
# Horus — Shadow Stack Overlay for Integration Testing
# ─────────────────────────────────────────────────────────────────────────────
# Usage (managed by \`horus test-env acquire\`):
#
#   docker compose \\
#     -p horus-test-0 \\
#     -f ~/Horus/docker-compose.yml \\
#     -f ~/Horus/docker-compose.test.yml \\
#     up -d
#
# All TEST_PORT_* and TEST_DATA_PATH are set by \`horus test-env acquire\`.
# Slot 0 defaults: ports 9100-9399, data at ~/Horus/data/test-env/slot-0/
# ─────────────────────────────────────────────────────────────────────────────

services:
  anvil:
    ports:
      - "\${TEST_PORT_ANVIL:-9100}:8100"
    volumes:
      - "\${TEST_DATA_PATH:-/tmp/horus-test}/notes:/data/notes:rw"

  vault-${vaultName}:
    ports:
      - "\${TEST_PORT_VAULT_SVC:-9101}:8000"
    volumes:
      - "\${TEST_DATA_PATH:-/tmp/horus-test}/vaults/${vaultName}:/data/knowledge-repo:rw"

  vault-router:
    ports:
      - "\${TEST_PORT_VAULT_ROUTER:-9150}:8400"

  vault-mcp:
    ports:
      - "\${TEST_PORT_VAULT_MCP:-9200}:8300"

  forge:
    ports:
      - "\${TEST_PORT_FORGE:-9250}:8200"
    volumes:
      - "\${TEST_DATA_PATH:-/tmp/horus-test}/config:/data/config:rw"
      - "\${TEST_DATA_PATH:-/tmp/horus-test}/registry:/data/registry:rw"
      - "\${TEST_DATA_PATH:-/tmp/horus-test}/workspaces:/data/workspaces:rw"
      - "\${TEST_DATA_PATH:-/tmp/horus-test}/repos:/data/horus-repos:rw"
      - "\${TEST_DATA_PATH:-/tmp/horus-test}/sessions:/data/sessions:rw"

  typesense:
    ports:
      - "\${TEST_PORT_TYPESENSE:-9108}:8108"
    volumes:
      - "\${TEST_DATA_PATH:-/tmp/horus-test}/typesense-data:/data"

  reader:
    ports:
      - "\${TEST_PORT_UI:-9260}:8400"

  neo4j:
    ports:
      - "\${TEST_PORT_NEO4J_HTTP:-9474}:7474"
      - "\${TEST_PORT_NEO4J_BOLT:-9687}:7687"
    volumes:
      - "\${TEST_DATA_PATH:-/tmp/horus-test}/neo4j-data:/data"
      - "\${TEST_DATA_PATH:-/tmp/horus-test}/neo4j-logs:/logs"
`;
}

// ── Dynamic compose generation ───────────────────────────────────────────────

/**
 * Generate the full docker-compose YAML content dynamically from config.
 * Creates one vault-{name} service per vault entry, a vault-router that
 * fronts them all, and static services for anvil, vault-mcp, forge,
 * and typesense.
 */
export function generateComposeFile(config: Config, runtime?: 'docker' | 'podman'): string {
  const vaultEntries = Object.entries(config.vaults).sort(([a], [b]) => a.localeCompare(b));

  // Build per-vault service blocks
  const vaultServices = vaultEntries.map(([name, vault], index) => {
    const hostPort = `800${index + 1}`;
    const envVarName = `VAULT_REST_PORT_${name.toUpperCase().replace(/-/g, '_')}`;
    const githubHost = resolveGitHubHost(vault.repo, config.github_hosts);
    const token = githubHost?.token ?? '';
    const apiHost = githubHost?.host ?? 'github.com';

    return `\
  # ── Vault: ${name} ─────────────────────────────────────────────────────────
  vault-${name}:
    image: ghcr.io/arjunkhera/horus/vault:latest
    ports:
      - "\${${envVarName}:-${hostPort}}:8000"
    volumes:
      - \${HORUS_DATA_PATH}/vaults/${name}:/data/knowledge-repo:rw
      - vault-${name}-workspace:/data/workspace
    environment:
      - HORUS_RUNTIME=\${HORUS_RUNTIME:-docker}
      - KNOWLEDGE_REPO_PATH=/data/knowledge-repo
      - WORKSPACE_PATH=/data/workspace
      - VAULT_KNOWLEDGE_REPO_URL=${vault.repo}
      - SYNC_INTERVAL=\${VAULT_SYNC_INTERVAL:-300}
      - VAULT_SYNC_INTERVAL=\${VAULT_SYNC_INTERVAL:-300}
      - LOG_LEVEL=\${LOG_LEVEL:-info}
      - HOST=0.0.0.0
      - PORT=8000
      - GITHUB_TOKEN=${token}
      - GITHUB_API_HOST=${apiHost}
      - TYPESENSE_HOST=typesense
      - TYPESENSE_PORT=8108
      - TYPESENSE_API_KEY=\${TYPESENSE_API_KEY:-horus-local-key}
      - NEO4J_URI=bolt://neo4j:7687
      - NEO4J_USER=neo4j
      - NEO4J_PASSWORD=horus-neo4j
    depends_on:
      typesense:
        condition: service_healthy
      neo4j:
        condition: service_healthy
    networks:
      - horus-net
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 512m
        reservations:
          memory: 256m
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      start_period: 60s
      retries: 3`;
  });

  // Build vault-router service
  const defaultVaultEntry = vaultEntries.find(([, v]) => v.default);
  const defaultVaultName = defaultVaultEntry ? defaultVaultEntry[0] : (vaultEntries[0]?.[0] ?? '');
  const vaultEndpoints = vaultEntries
    .map(([name]) => `${name}=http://vault-${name}:8000`)
    .join(',');
  const vaultRouterDependsOn = vaultEntries
    .map(([name]) => `      vault-${name}:\n        condition: service_healthy`)
    .join('\n');

  const vaultRouterService = `\
  # ── Vault Router ───────────────────────────────────────────────────────────
  # Routes requests to the appropriate vault instance by name.
  vault-router:
    image: ghcr.io/arjunkhera/horus/vault-router:latest
    ports:
      - "\${VAULT_ROUTER_PORT:-8050}:8400"
    environment:
${vaultEndpoints ? `      - VAULT_ENDPOINTS=${vaultEndpoints}\n` : ''}      - VAULT_DEFAULT=${defaultVaultName}
${vaultRouterDependsOn ? `    depends_on:\n${vaultRouterDependsOn}\n` : ''}    networks:
      - horus-net
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 256m
        reservations:
          memory: 64m
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8400/health')"]
      interval: 30s
      timeout: 10s
      start_period: 30s
      retries: 3`;

  const vaultMcpService = `\
  # ── Vault MCP ──────────────────────────────────────────────────────────────
  # Thin MCP adapter that translates MCP tool calls to Vault REST API calls.
  vault-mcp:
    image: ghcr.io/arjunkhera/horus/vault-mcp:latest
    ports:
      - "\${VAULT_MCP_PORT:-8300}:8300"
    environment:
      - VAULT_MCP_HTTP=true
      - VAULT_MCP_PORT=8300
      - VAULT_MCP_HOST=0.0.0.0
      - KNOWLEDGE_SERVICE_URL=http://vault-router:8400
    depends_on:
      vault-router:
        condition: service_healthy
    networks:
      - horus-net
    restart: unless-stopped
    stop_grace_period: 15s
    deploy:
      resources:
        limits:
          memory: 256m
        reservations:
          memory: 64m
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8300/health"]
      interval: 30s
      timeout: 5s
      start_period: 30s
      retries: 3`;

  // Build volumes section
  const vaultVolumeEntries = [
    ...vaultEntries.map(([name]) => `  vault-${name}-workspace:`),
    '  neo4j-data:',
    '  neo4j-logs:',
  ].join('\n');

  const sections: string[] = [
    '# ─────────────────────────────────────────────────────────────────────────────',
    '# Horus — Generated Docker Compose',
    '# Managed by @arkhera30/cli. Do not edit manually.',
    '# Generated dynamically from ~/Horus/config.yaml by `horus setup`.',
    '# ─────────────────────────────────────────────────────────────────────────────',
    '',
    'services:',
    '',
    ANVIL_SERVICE,
    '',
    ...vaultServices.map((s) => s + '\n'),
    vaultRouterService,
    '',
    vaultMcpService,
    '',
    FORGE_SERVICE,
    '',
    NEO4J_SERVICE,
    '',
    TYPESENSE_SERVICE,
    '',
    ...(config.enable_ui !== false ? [READER_SERVICE, ''] : []),
    '# ── Networks ──────────────────────────────────────────────────────────────────',
    'networks:',
    '  horus-net:',
    '    driver: bridge',
    '',
    '# ── Volumes ───────────────────────────────────────────────────────────────────',
    'volumes:',
    vaultVolumeEntries,
  ];

  let content = sections.join('\n');

  if (runtime === 'podman') {
    content = applyPodmanUserOverride(content);
  }

  return content;
}

// ── Standalone compose generation ────────────────────────────────────────────

/**
 * Generate a fully-projected standalone Docker Compose file for an isolated
 * shadow stack slot.
 *
 * Unlike the overlay approach (base + docker-compose.test.yml), this file is
 * completely self-contained: every port binding and every volume path is
 * hard-coded to the slot's values. No env-var defaults from the base compose
 * are inherited, so Docker Compose v2 cannot append port arrays and cause
 * collisions with the live stack.
 *
 * Isolation invariants enforced here:
 *  - Distinct docker project name  (horus-test-{slot})
 *  - Distinct network name         (horus-test-{slot}-net)
 *  - Explicit, non-merged port bindings (no ${VAR:-default})
 *  - Slot-scoped data directory for all volumes
 *  - Named volumes prefixed with the project name (disjoint from live)
 *  - Forge config/registry/workspaces/sessions point into slot dir
 *
 * The file is written to {slotDataPath}/docker-compose.standalone.yml and
 * used exclusively; the live compose files are never touched.
 */
export interface StandaloneSlotPorts {
  anvil: number;
  vault_svc: number;
  vault_router: number;
  vault_mcp: number;
  forge: number;
  typesense: number;
  ui: number;
  neo4j_http: number;
  neo4j_bolt: number;
}

export function generateStandaloneComposeFile(options: {
  config: Config;
  ports: StandaloneSlotPorts;
  slotDataPath: string;
  slot: number;
  runtime?: 'docker' | 'podman';
  imageOverrides?: Record<string, string>;
}): string {
  const { config, ports, slotDataPath, slot, runtime, imageOverrides } = options;

  const project = `horus-test-${slot}`;
  const network = `${project}-net`;

  const vaultEntries = Object.entries(config.vaults).sort(([a], [b]) => a.localeCompare(b));
  const defaultVaultEntry = vaultEntries.find(([, v]) => v.default);
  const defaultVaultName = defaultVaultEntry ? defaultVaultEntry[0] : (vaultEntries[0]?.[0] ?? 'default');

  // Helper: get image for a service (respects --image overrides)
  function img(service: string, fallback: string): string {
    return imageOverrides?.[service] ?? fallback;
  }

  // Build vault service blocks — one per vault in config
  const vaultServices = vaultEntries.map(([name], index) => {
    const vault = config.vaults[name];
    const githubHost = resolveGitHubHost(vault?.repo ?? '', config.github_hosts);
    const token = githubHost?.token ?? '';
    const apiHost = githubHost?.host ?? 'github.com';
    // Each vault gets its own port offset; only the default vault gets the
    // explicit slot port; extra vaults get sequential ports above it.
    const vaultHostPort = index === 0 ? ports.vault_svc : ports.vault_svc + index;
    const serviceImage = img(`vault-${name}`, 'ghcr.io/arjunkhera/horus/vault:latest');
    let block = `\
  vault-${name}:
    image: ${serviceImage}
    ports:
      - "${vaultHostPort}:8000"
    volumes:
      - ${slotDataPath}/vaults/${name}:/data/knowledge-repo:rw
      - ${project}-vault-${name}-workspace:/data/workspace
    environment:
      - HORUS_RUNTIME=${runtime ?? 'docker'}
      - KNOWLEDGE_REPO_PATH=/data/knowledge-repo
      - WORKSPACE_PATH=/data/workspace
      - VAULT_KNOWLEDGE_REPO_URL=${vault?.repo ?? ''}
      - SYNC_INTERVAL=300
      - VAULT_SYNC_INTERVAL=300
      - LOG_LEVEL=info
      - HOST=0.0.0.0
      - PORT=8000
      - GITHUB_TOKEN=${token}
      - GITHUB_API_HOST=${apiHost}
      - TYPESENSE_HOST=typesense
      - TYPESENSE_PORT=8108
      - TYPESENSE_API_KEY=horus-local-key
      - NEO4J_URI=bolt://neo4j:7687
      - NEO4J_USER=neo4j
      - NEO4J_PASSWORD=horus-neo4j
    depends_on:
      typesense:
        condition: service_healthy
      neo4j:
        condition: service_healthy
    networks:
      - ${network}
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 512m
        reservations:
          memory: 256m
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      start_period: 60s
      retries: 3`;
    if (runtime === 'podman') {
      block = block.replace(/^(    image: .+)$/m, '$1\n    user: "0:0"');
    }
    return block;
  });

  // Vault router depends-on block
  const vaultRouterDependsOn = vaultEntries
    .map(([name]) => `      vault-${name}:\n        condition: service_healthy`)
    .join('\n');
  const vaultEndpoints = vaultEntries
    .map(([name]) => `${name}=http://vault-${name}:8000`)
    .join(',');

  const vaultRouterImage = img('vault-router', 'ghcr.io/arjunkhera/horus/vault-router:latest');
  let vaultRouterBlock = `\
  vault-router:
    image: ${vaultRouterImage}
    ports:
      - "${ports.vault_router}:8400"
    environment:
${vaultEndpoints ? `      - VAULT_ENDPOINTS=${vaultEndpoints}\n` : ''}      - VAULT_DEFAULT=${defaultVaultName}
      - LOG_LEVEL=info
${vaultRouterDependsOn ? `    depends_on:\n${vaultRouterDependsOn}\n` : ''}    networks:
      - ${network}
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 256m
        reservations:
          memory: 64m
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8400/health')"]
      interval: 30s
      timeout: 10s
      start_period: 30s
      retries: 3`;
  if (runtime === 'podman') {
    vaultRouterBlock = vaultRouterBlock.replace(/^(    image: .+)$/m, '$1\n    user: "0:0"');
  }

  const vaultMcpImage = img('vault-mcp', 'ghcr.io/arjunkhera/horus/vault-mcp:latest');
  let vaultMcpBlock = `\
  vault-mcp:
    image: ${vaultMcpImage}
    ports:
      - "${ports.vault_mcp}:8300"
    environment:
      - VAULT_MCP_HTTP=true
      - VAULT_MCP_PORT=8300
      - VAULT_MCP_HOST=0.0.0.0
      - KNOWLEDGE_SERVICE_URL=http://vault-router:8400
    depends_on:
      vault-router:
        condition: service_healthy
    networks:
      - ${network}
    restart: unless-stopped
    stop_grace_period: 15s
    deploy:
      resources:
        limits:
          memory: 256m
        reservations:
          memory: 64m
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8300/health"]
      interval: 30s
      timeout: 5s
      start_period: 30s
      retries: 3`;
  if (runtime === 'podman') {
    vaultMcpBlock = vaultMcpBlock.replace(/^(    image: .+)$/m, '$1\n    user: "0:0"');
  }

  const anvilImage = img('anvil', 'ghcr.io/arjunkhera/horus/anvil:latest');
  let anvilBlock = `\
  anvil:
    image: ${anvilImage}
    ports:
      - "${ports.anvil}:8100"
    volumes:
      - ${slotDataPath}/notes:/data/notes:rw
    environment:
      - HORUS_RUNTIME=${runtime ?? 'docker'}
      - ANVIL_TRANSPORT=http
      - ANVIL_PORT=8100
      - ANVIL_HOST=0.0.0.0
      - ANVIL_NOTES_PATH=/data/notes
      - ANVIL_REPO_URL=
      - ANVIL_SYNC_INTERVAL=300
      - ANVIL_DEBOUNCE_SECONDS=5
      - GITHUB_TOKEN=
      - TYPESENSE_HOST=typesense
      - TYPESENSE_PORT=8108
      - TYPESENSE_API_KEY=horus-local-key
      - NEO4J_URI=bolt://neo4j:7687
      - NEO4J_USER=neo4j
      - NEO4J_PASSWORD=horus-neo4j
    depends_on:
      typesense:
        condition: service_healthy
      neo4j:
        condition: service_healthy
    networks:
      - ${network}
    restart: unless-stopped
    stop_grace_period: 15s
    deploy:
      resources:
        limits:
          memory: 512m
        reservations:
          memory: 256m
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8100/health"]
      interval: 30s
      timeout: 5s
      start_period: 60s
      retries: 3`;
  if (runtime === 'podman') {
    anvilBlock = anvilBlock.replace(/^(    image: .+)$/m, '$1\n    user: "0:0"');
  }

  const forgeImage = img('forge', 'ghcr.io/arjunkhera/horus/forge:latest');
  let forgeBlock = `\
  forge:
    image: ${forgeImage}
    ports:
      - "${ports.forge}:8200"
    volumes:
      - ${slotDataPath}/config:/data/config:rw
      - ${slotDataPath}/registry:/data/registry:rw
      - ${slotDataPath}/workspaces:/data/workspaces:rw
      - ${slotDataPath}/repos:/data/horus-repos:rw
      - ${slotDataPath}/sessions:/data/sessions:rw
    environment:
      - HORUS_RUNTIME=${runtime ?? 'docker'}
      - FORGE_PORT=8200
      - FORGE_HOST=0.0.0.0
      - FORGE_REGISTRY_PATH=/data/registry
      - FORGE_WORKSPACES_PATH=/data/workspaces
      - FORGE_CONFIG_PATH=/data/config
      - FORGE_MANAGED_REPOS_PATH=/data/horus-repos
      - FORGE_REGISTRY_REPO_URL=
      - FORGE_SYNC_INTERVAL=300
      - FORGE_ANVIL_URL=http://anvil:8100
      - FORGE_VAULT_URL=http://vault-mcp:8300
      - FORGE_HOST_WORKSPACES_PATH=${slotDataPath}/workspaces
      - FORGE_HOST_MANAGED_REPOS_PATH=${slotDataPath}/repos
      - FORGE_HOST_REPOS_PATH=${slotDataPath}/repos
      - FORGE_HOST_ANVIL_URL=http://localhost:${ports.anvil}
      - FORGE_HOST_VAULT_URL=http://localhost:${ports.vault_mcp}
      - FORGE_HOST_FORGE_URL=http://localhost:${ports.forge}
      - FORGE_SCAN_PATHS=/data/horus-repos
      - FORGE_SESSION_TTL_MS=1800000
      - GITHUB_TOKEN=
      - TYPESENSE_HOST=typesense
      - TYPESENSE_PORT=8108
      - TYPESENSE_API_KEY=horus-local-key
    depends_on:
      anvil:
        condition: service_healthy
      typesense:
        condition: service_healthy
      vault-router:
        condition: service_healthy
    networks:
      - ${network}
    restart: unless-stopped
    stop_grace_period: 15s
    deploy:
      resources:
        limits:
          memory: 512m
        reservations:
          memory: 128m
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8200/health"]
      interval: 30s
      timeout: 5s
      start_period: 60s
      retries: 3`;
  if (runtime === 'podman') {
    forgeBlock = forgeBlock.replace(/^(    image: .+)$/m, '$1\n    user: "0:0"');
  }

  const typesenseBlock = `\
  typesense:
    image: typesense/typesense:27.1
    ports:
      - "${ports.typesense}:8108"
    volumes:
      - ${slotDataPath}/typesense-data:/data
    command: >
      --data-dir=/data
      --api-key=horus-local-key
      --enable-cors
    networks:
      - ${network}
    healthcheck:
      test: ["CMD-SHELL", "bash -c 'echo > /dev/tcp/localhost/8108'"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 5s
    restart: unless-stopped`;

  const neo4jBlock = `\
  neo4j:
    image: neo4j:5-community
    ports:
      - "${ports.neo4j_http}:7474"
      - "${ports.neo4j_bolt}:7687"
    volumes:
      - ${slotDataPath}/neo4j-data:/data
      - ${slotDataPath}/neo4j-logs:/logs
    environment:
      - NEO4J_AUTH=neo4j/horus-neo4j
      - NEO4J_server_memory_heap_initial__size=256m
      - NEO4J_server_memory_heap_max__size=512m
      - NEO4J_server_memory_pagecache_size=256m
      - NEO4J_PLUGINS=[]
    networks:
      - ${network}
    restart: unless-stopped
    stop_grace_period: 30s
    deploy:
      resources:
        limits:
          memory: 1g
        reservations:
          memory: 512m
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:7474"]
      interval: 30s
      timeout: 10s
      start_period: 60s
      retries: 3`;

  // Build volumes section (named volumes prefixed with project to stay disjoint from live)
  const vaultVolumeNames = vaultEntries.map(([name]) => `  ${project}-vault-${name}-workspace:`).join('\n');
  const volumesSection: string[] = vaultVolumeNames
    ? [
        `# ── Volumes ───────────────────────────────────────────────────────────────────`,
        `volumes:`,
        vaultVolumeNames,
      ]
    : [];

  const sections: string[] = [
    `# ─────────────────────────────────────────────────────────────────────────────`,
    `# Horus — Standalone Shadow Stack (slot ${slot})`,
    `# Generated by \`horus test-env acquire --standalone\`. Do not edit manually.`,
    `# Fully-projected: no overlay merge; all ports/volumes are explicit.`,
    `# Isolation: project=${project}  network=${network}`,
    `# ─────────────────────────────────────────────────────────────────────────────`,
    ``,
    `services:`,
    ``,
    anvilBlock,
    ``,
    ...vaultServices.map((s) => s + '\n'),
    vaultRouterBlock,
    ``,
    vaultMcpBlock,
    ``,
    forgeBlock,
    ``,
    typesenseBlock,
    ``,
    neo4jBlock,
    ``,
    `# ── Networks ──────────────────────────────────────────────────────────────────`,
    `networks:`,
    `  ${network}:`,
    `    driver: bridge`,
    ``,
    ...volumesSection,
  ];

  return sections.join('\n');
}

/**
 * Path where the standalone compose file is written for a given slot.
 */
export function standaloneComposePath(slotDataPath: string): string {
  return `${slotDataPath}/docker-compose.standalone.yml`;
}

// ── Compose file management ─────────────────────────────────────────────────

/**
 * Check if the compose file is already installed at ~/Horus/.
 */
export function composeFileExists(): boolean {
  return existsSync(COMPOSE_PATH);
}

/**
 * Install docker-compose.yml and docker-compose.test.yml to ~/Horus/.
 * Dynamically generates the file from config, supporting multiple vaults.
 * When the runtime is Podman, services are overridden to run as root inside
 * the container so they can write to host-mounted volumes.
 */
export function installComposeFile(config: Config, runtime?: 'docker' | 'podman'): void {
  ensureHorusDir();
  const content = generateComposeFile(config, runtime);
  writeFileSync(COMPOSE_PATH, content, 'utf-8');
  writeFileSync(COMPOSE_TEST_PATH, generateTestComposeFile(config), 'utf-8');
}

/**
 * Read the installed compose file content.
 */
export function readComposeFile(): string {
  if (!existsSync(COMPOSE_PATH)) {
    throw new Error(
      `Compose file not found at ${COMPOSE_PATH}.\n` +
        'Run `horus setup` to install it.'
    );
  }
  return readFileSync(COMPOSE_PATH, 'utf-8');
}
