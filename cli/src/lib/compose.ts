import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPOSE_PATH } from './constants.js';
import { ensureHorusDir } from './config.js';

// ── Resolve bundled compose file path ───────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get the path to the bundled docker-compose.yml.
 * In the built output, the compose directory is at ../../compose/ relative to dist/lib/.
 * In the source, it's at ../../compose/ relative to src/lib/.
 */
function getBundledComposePath(): string {
  // Try multiple possible locations (handles both dev and built paths)
  const candidates = [
    join(__dirname, '..', '..', 'compose', 'docker-compose.yml'),
    join(__dirname, '..', 'compose', 'docker-compose.yml'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'Bundled docker-compose.yml not found. The CLI package may be corrupted.\n' +
      `Searched: ${candidates.join(', ')}`
  );
}

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

// ── Compose file management ─────────────────────────────────────────────────

/**
 * Check if the compose file is already installed at ~/Horus/.
 */
export function composeFileExists(): boolean {
  return existsSync(COMPOSE_PATH);
}

/**
 * Install the bundled docker-compose.yml to ~/Horus/docker-compose.yml.
 * When the runtime is Podman, services are overridden to run as root inside
 * the container so they can write to host-mounted volumes.
 */
export function installComposeFile(runtime?: 'docker' | 'podman'): void {
  ensureHorusDir();
  const bundledPath = getBundledComposePath();
  let content = readFileSync(bundledPath, 'utf-8');

  if (runtime === 'podman') {
    content = applyPodmanUserOverride(content);
  }

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
