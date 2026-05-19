/**
 * AC-4 — Documented as the single source of every enterprise/SaaS difference
 * (consumed by F3 and later tracks).
 *
 * RED until @horus/scope README is written.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

describe('AC-4 README documents DeploymentProfile as the single source of difference', () => {
  it('ships a README naming DeploymentProfile as the single enterprise/SaaS difference source', () => {
    const readme = readFileSync(join(here, '..', 'README.md'), 'utf8');
    expect(readme).toMatch(/DeploymentProfile/);
    expect(readme).toMatch(/single source/i);
    expect(readme).toMatch(/SaaS/);
    expect(readme).toMatch(/enterprise/i);
  });
});
