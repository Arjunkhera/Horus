/**
 * registry-persistence.test.ts
 *
 * Asserts that deploy/argocd/apps/horus-control-plane.yaml has the ArgoCD
 * ignoreDifferences + RespectIgnoreDifferences entries that prevent selfHeal
 * from reverting operator-owned vault-registry ConfigMap data.
 *
 * The ArgoCD YAML path is resolved by walking up from this test file's
 * real location on disk until we find the repo root (contains package.json +
 * pnpm-workspace.yaml), then descending to the expected path.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Walk up from startDir until we find a directory containing both
 * package.json and pnpm-workspace.yaml (repo root marker), then
 * return the path to the ArgoCD app yaml.
 */
function findArgocdYaml(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (
      existsSync(join(dir, 'pnpm-workspace.yaml')) &&
      existsSync(join(dir, 'package.json'))
    ) {
      return join(dir, 'deploy/argocd/apps/horus-control-plane.yaml');
    }
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  throw new Error(
    `Could not find repo root from ${startDir}. ` +
    `Looked for pnpm-workspace.yaml + package.json.`,
  );
}

const ARGOCD_YAML = findArgocdYaml(__dirname);

describe('deploy/argocd/apps/horus-control-plane.yaml — registry protection', () => {
  it('file exists and parses as valid YAML', () => {
    expect(existsSync(ARGOCD_YAML), `ArgoCD yaml not found at ${ARGOCD_YAML}`).toBe(true);
    const raw = readFileSync(ARGOCD_YAML, 'utf8');
    const doc = parseYaml(raw);
    expect(doc).toBeTruthy();
  });

  it('has ignoreDifferences entry for vault-registry ConfigMap with /data pointer', () => {
    const raw = readFileSync(ARGOCD_YAML, 'utf8');
    const parsed = parseYaml(raw) as {
      spec?: {
        ignoreDifferences?: Array<{
          group?: string;
          kind?: string;
          name?: string;
          namespace?: string;
          jsonPointers?: string[];
        }>;
      };
    };

    const ignoreDiffs = parsed?.spec?.ignoreDifferences ?? [];
    const registryEntry = ignoreDiffs.find(
      (d) =>
        d.kind === 'ConfigMap' &&
        d.name === 'vault-registry' &&
        d.namespace === 'horus-system',
    );

    expect(registryEntry, 'missing ignoreDifferences entry for vault-registry ConfigMap').toBeTruthy();
    expect(registryEntry?.jsonPointers, 'jsonPointers must include /data').toContain('/data');
  });

  it('has RespectIgnoreDifferences=true in syncOptions', () => {
    const raw = readFileSync(ARGOCD_YAML, 'utf8');
    const parsed = parseYaml(raw) as {
      spec?: {
        syncPolicy?: {
          syncOptions?: string[];
        };
      };
    };

    const syncOptions = parsed?.spec?.syncPolicy?.syncOptions ?? [];
    expect(
      syncOptions.some((o) => o === 'RespectIgnoreDifferences=true'),
      'syncOptions must include RespectIgnoreDifferences=true',
    ).toBe(true);
  });
});
