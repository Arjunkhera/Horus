/**
 * Manifest loader — reads and validates a testenv/v1 manifest from disk.
 */

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { assertManifest } from '@akhera-horus/testenv';
import type { Manifest } from '@akhera-horus/testenv';

/**
 * Load a testenv/v1 manifest from a YAML file path.
 * Throws with actionable validation errors if the manifest is invalid.
 *
 * @param manifestPath - Absolute or relative path to manifest.yaml
 * @returns Validated Manifest
 */
export function loadManifest(manifestPath: string): Manifest {
  let raw: unknown;
  try {
    const content = readFileSync(manifestPath, 'utf-8');
    raw = parseYaml(content);
  } catch (e) {
    throw new Error(`Failed to read manifest at "${manifestPath}": ${(e as Error).message}`);
  }
  return assertManifest(raw);
}
