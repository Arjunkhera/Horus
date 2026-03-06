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

// ── Compose file management ─────────────────────────────────────────────────

/**
 * Check if the compose file is already installed at ~/.horus/.
 */
export function composeFileExists(): boolean {
  return existsSync(COMPOSE_PATH);
}

/**
 * Copy the bundled docker-compose.yml to ~/.horus/docker-compose.yml.
 */
export function installComposeFile(): void {
  ensureHorusDir();
  const bundledPath = getBundledComposePath();
  const content = readFileSync(bundledPath, 'utf-8');
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
