/**
 * Validate .testenv/manifest.yaml against the @horus/testenv schema.
 * Run: node .testenv/validate.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import { validateManifest, formatValidationErrors } from '../packages/testenv/dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(__dirname, 'manifest.yaml');

const raw = readFileSync(manifestPath, 'utf8');
const parsed = parse(raw);

const result = validateManifest(parsed);

if (result.ok) {
  console.log('✓ manifest.yaml is valid (testenv/v1)');
  console.log(`  repo: ${result.data.repo}`);
  console.log(`  secrets: ${result.data.requires.secrets.join(', ')}`);
  console.log(`  profiles: ${Object.keys(result.data.requires.profiles ?? {}).join(', ')}`);
  console.log(`  phases: ${Object.keys(result.data.phases).join(', ')}`);
  console.log(`  test actions: ${result.data.phases.test.actions.map(a => a.name).join(', ')}`);
  process.exit(0);
} else {
  console.error('✗ manifest.yaml validation FAILED:');
  console.error(formatValidationErrors(result.errors));
  process.exit(1);
}
