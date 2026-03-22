import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { COMPOSE_PATH } from './constants.js';
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
      - \${HORUS_DATA_PATH}/registry:/data/registry:rw
      - \${HORUS_DATA_PATH}/workspaces:/data/workspaces:rw
      - \${HOST_REPOS_PATH}:/data/repos:ro
    environment:
      - HORUS_RUNTIME=\${HORUS_RUNTIME:-docker}
      - FORGE_PORT=8200
      - FORGE_HOST=0.0.0.0
      - FORGE_REGISTRY_PATH=/data/registry
      - FORGE_WORKSPACES_PATH=/data/workspaces
      - FORGE_REGISTRY_REPO_URL=\${FORGE_REGISTRY_REPO_URL:-}
      - FORGE_SYNC_INTERVAL=\${FORGE_SYNC_INTERVAL:-300}
      - FORGE_ANVIL_URL=http://anvil:8100
      - FORGE_VAULT_URL=http://vault-mcp:8300
      - FORGE_HOST_WORKSPACES_PATH=\${HORUS_DATA_PATH}/workspaces
      - FORGE_HOST_REPOS_PATH=\${HOST_REPOS_PATH}
      - FORGE_HOST_ANVIL_URL=http://localhost:\${ANVIL_PORT:-8100}
      - FORGE_HOST_VAULT_URL=http://localhost:\${VAULT_MCP_PORT:-8300}
      - FORGE_HOST_FORGE_URL=http://localhost:\${FORGE_PORT:-8200}
      - FORGE_SCAN_PATHS=\${FORGE_SCAN_PATHS:-/data/repos}
      - GITHUB_TOKEN=\${GITHUB_TOKEN:-}
    depends_on:
      anvil:
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

const HORUS_UI_SERVICE = `\
  # ── Horus UI ───────────────────────────────────────────────────────────────
  # Web interface — React SPA served by Express proxy on port 8400.
  # Proxies /api/anvil, /api/vault, /api/forge to the respective services.
  # Stores dashboard configs and preferences in _system/ui/ (not indexed by Anvil).
  horus-ui:
    image: ghcr.io/arjunkhera/horus/horus-ui:latest
    ports:
      - "\${UI_PORT:-8400}:8400"
    volumes:
      - \${HORUS_DATA_PATH}/notes:/data/notes:rw
    environment:
      - PORT=8400
      - HORUS_DATA_PATH=/data/notes
      - ANVIL_URL=http://anvil:8100
      - VAULT_URL=http://vault-mcp:8300
      - FORGE_URL=http://forge:8200
      - NODE_ENV=production
    depends_on:
      anvil:
        condition: service_healthy
      vault-mcp:
        condition: service_healthy
      forge:
        condition: service_healthy
    networks:
      - horus-net
    restart: unless-stopped
    stop_grace_period: 10s
    deploy:
      resources:
        limits:
          memory: 256m
        reservations:
          memory: 64m
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8400/api/health"]
      interval: 30s
      timeout: 5s
      start_period: 30s
      retries: 3`;

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
      - VAULT_ENDPOINTS=${vaultEndpoints}
      - VAULT_DEFAULT=${defaultVaultName}
    depends_on:
${vaultRouterDependsOn}
    networks:
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
  const vaultVolumeEntries = vaultEntries.map(([name]) => `  vault-${name}-workspace:`).join('\n');

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
    TYPESENSE_SERVICE,
    '',
    ...(config.enable_ui !== false ? [HORUS_UI_SERVICE, ''] : []),
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

// ── Compose file management ─────────────────────────────────────────────────

/**
 * Check if the compose file is already installed at ~/Horus/.
 */
export function composeFileExists(): boolean {
  return existsSync(COMPOSE_PATH);
}

/**
 * Install the generated docker-compose.yml to ~/Horus/docker-compose.yml.
 * Dynamically generates the file from config, supporting multiple vaults.
 * When the runtime is Podman, services are overridden to run as root inside
 * the container so they can write to host-mounted volumes.
 */
export function installComposeFile(config: Config, runtime?: 'docker' | 'podman'): void {
  ensureHorusDir();
  const content = generateComposeFile(config, runtime);
  writeFileSync(COMPOSE_PATH, content, 'utf-8');
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
