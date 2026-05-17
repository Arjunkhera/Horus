/**
 * testenv-runner unit and integration tests.
 *
 * Uses fixture manifests under ../fixtures/ to exercise:
 * - Full 6-phase run (needsStack=false actions skip setup/launch/await_ready/connection)
 * - Stack-skip (E3): all needsStack=false → phases 1-4 skipped
 * - fail-fast policy: stops after first failure, marks remaining as skip
 * - run-all policy: continues after failure
 * - Secret redaction: secrets removed from output
 * - RunResult schema conformance (via validateRunResult from @horus/testenv)
 * - Teardown always runs
 * - Isolation invariant check evaluation
 * - Assertion evaluation
 * - Loader (loadManifest)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRunResult, validateManifest } from '@akhera-horus/testenv';
import type { Manifest } from '@akhera-horus/testenv';
import { run } from '../src/runner.js';
import { loadManifest } from '../src/loader.js';
import { buildRedactor, redactValue } from '../src/redact.js';
import { renderTemplate } from '../src/template.js';
import {
  evaluateAssertions,
  evaluatePhase1IsolationChecks,
  evaluatePhase2IsolationChecks,
  evaluatePhase6IsolationChecks,
  hasFailure,
} from '../src/assertions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'fixtures');

function fixtureManifest(name: string): Manifest {
  return loadManifest(join(fixturesDir, name));
}

// ---------------------------------------------------------------------------
// Loader tests
// ---------------------------------------------------------------------------

describe('loadManifest', () => {
  it('loads and validates the simple fixture', () => {
    const manifest = fixtureManifest('simple.manifest.yaml');
    expect(manifest.apiVersion).toBe('testenv/v1');
    expect(manifest.repo).toBe('fixture-simple');
    expect(manifest.phases.test.actions).toHaveLength(2);
  });

  it('throws on invalid path', () => {
    expect(() => loadManifest('/nonexistent/path/manifest.yaml')).toThrow(/Failed to read manifest/);
  });

  it('loads needsstack-false fixture', () => {
    const manifest = fixtureManifest('needsstack-false.manifest.yaml');
    expect(manifest.phases.test.actions.every((a) => a.needsStack === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Template tests
// ---------------------------------------------------------------------------

describe('renderTemplate', () => {
  it('substitutes {slot}', () => {
    expect(renderTemplate('{slot}/data', { slot: 'slot-1' })).toBe('slot-1/data');
  });

  it('substitutes multiple vars', () => {
    expect(renderTemplate('{slot}/{workdir}', { slot: 'a', workdir: 'b' })).toBe('a/b');
  });

  it('leaves unknown vars as-is', () => {
    expect(renderTemplate('{unknown}/path', {})).toBe('{unknown}/path');
  });
});

// ---------------------------------------------------------------------------
// Redaction tests
// ---------------------------------------------------------------------------

describe('buildRedactor', () => {
  it('redacts known secret values', () => {
    process.env['__TEST_SECRET_REDACT__'] = 'supersecret123';
    const redact = buildRedactor(['__TEST_SECRET_REDACT__']);
    expect(redact('the supersecret123 value')).toBe('the [REDACTED] value');
    delete process.env['__TEST_SECRET_REDACT__'];
  });

  it('is a no-op when no secrets', () => {
    const redact = buildRedactor([]);
    expect(redact('hello world')).toBe('hello world');
  });

  it('redacts in nested objects via redactValue', () => {
    process.env['__TEST_NESTED_SECRET__'] = 'topsecret';
    const redact = buildRedactor(['__TEST_NESTED_SECRET__']);
    const result = redactValue({ key: 'topsecret in here', nested: { val: 'topsecret' } }, redact);
    expect(result).toEqual({ key: '[REDACTED] in here', nested: { val: '[REDACTED]' } });
    delete process.env['__TEST_NESTED_SECRET__'];
  });

  it('handles unset env var gracefully (no-op)', () => {
    delete process.env['__NONEXISTENT_SECRET__'];
    const redact = buildRedactor(['__NONEXISTENT_SECRET__']);
    expect(redact('hello')).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// Assertion evaluation tests
// ---------------------------------------------------------------------------

describe('evaluateAssertions', () => {
  it('evaluates path_exists — pass', () => {
    const results = evaluateAssertions(
      [{ type: 'path_exists', path: '/tmp' }],
      {},
    );
    expect(results[0].status).toBe('pass');
  });

  it('evaluates path_exists — fail', () => {
    const results = evaluateAssertions(
      [{ type: 'path_exists', path: '/tmp/nonexistent-testenv-runner-path-xyz' }],
      {},
    );
    expect(results[0].status).toBe('fail');
  });

  it('evaluates cmd_exit_zero — pass', () => {
    const results = evaluateAssertions(
      [{ type: 'cmd_exit_zero', run: 'echo ok' }],
      {},
    );
    expect(results[0].status).toBe('pass');
  });

  it('evaluates cmd_exit_zero — fail', () => {
    const results = evaluateAssertions(
      [{ type: 'cmd_exit_zero', run: 'exit 1' }],
      {},
    );
    expect(results[0].status).toBe('fail');
  });

  it('evaluates env_vars_present — pass', () => {
    process.env['__TEST_ENV_PRESENT__'] = 'yes';
    const results = evaluateAssertions(
      [{ type: 'env_vars_present', names: ['__TEST_ENV_PRESENT__'] }],
      {},
    );
    expect(results[0].status).toBe('pass');
    delete process.env['__TEST_ENV_PRESENT__'];
  });

  it('evaluates env_vars_present — fail', () => {
    delete process.env['__TEST_MISSING_ENV__'];
    const results = evaluateAssertions(
      [{ type: 'env_vars_present', names: ['__TEST_MISSING_ENV__'] }],
      {},
    );
    expect(results[0].status).toBe('fail');
  });

  it('evaluates structural assertions as pass (delegated)', () => {
    const structural: Array<Parameters<typeof evaluateAssertions>[0][0]> = [
      { type: 'ports_disjoint_from_live', value: true },
      { type: 'live_stack_unmodified', value: true },
      { type: 'live_data_test_artifacts_zero', value: true },
      { type: 'no_secret_residue', value: true },
      { type: 'fully_projected_ports', value: true },
    ];
    const results = evaluateAssertions(structural, {});
    for (const r of results) {
      expect(r.status).toBe('pass');
    }
  });

  it('hasFailure returns true when any result is fail', () => {
    expect(hasFailure([{ type: 'x', status: 'fail' }])).toBe(true);
    expect(hasFailure([{ type: 'x', status: 'pass' }])).toBe(false);
    expect(hasFailure([{ type: 'x', status: 'error' }])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Isolation check evaluation tests
// ---------------------------------------------------------------------------

describe('isolation invariant checks', () => {
  it('Phase-1: allRequiredSecretsPresent — pass when secrets present', () => {
    process.env['__TEST_ISO_SECRET__'] = 'val';
    const checks = evaluatePhase1IsolationChecks(
      { allRequiredSecretsPresent: true, disjointDockerProject: false, disjointDockerNetworks: false, disjointDockerVolumes: false, disjointPortSpace: false, disjointDataDir: false },
      ['__TEST_ISO_SECRET__'],
      {},
    );
    const check = checks.find((c) => c.check === 'allRequiredSecretsPresent');
    expect(check?.status).toBe('pass');
    delete process.env['__TEST_ISO_SECRET__'];
  });

  it('Phase-1: allRequiredSecretsPresent — fail when secrets missing', () => {
    delete process.env['__TEST_MISSING_ISO_SECRET__'];
    const checks = evaluatePhase1IsolationChecks(
      { allRequiredSecretsPresent: true, disjointDockerProject: false, disjointDockerNetworks: false, disjointDockerVolumes: false, disjointPortSpace: false, disjointDataDir: false },
      ['__TEST_MISSING_ISO_SECRET__'],
      {},
    );
    const check = checks.find((c) => c.check === 'allRequiredSecretsPresent');
    expect(check?.status).toBe('fail');
  });

  it('Phase-2: connectionManifestEmitted — fail if path missing', () => {
    const checks = evaluatePhase2IsolationChecks(
      { distinctDockerProject: false, fullyProjectedPorts: false, connectionManifestEmitted: true },
      { emitPath: '/tmp/nonexistent-connection-manifest-xyz.json' },
    );
    const check = checks.find((c) => c.check === 'connectionManifestEmitted');
    expect(check?.status).toBe('fail');
  });

  it('Phase-6: all checks pass (delegated)', () => {
    const checks = evaluatePhase6IsolationChecks({
      liveStackUnmodified: true,
      liveDataTestArtifactsZero: true,
      noSecretResidue: true,
    });
    for (const c of checks) {
      expect(c.status).toBe('pass');
    }
  });
});

// ---------------------------------------------------------------------------
// Runner integration tests
// ---------------------------------------------------------------------------

describe('runner — simple fixture (needsStack=false → stack skipped)', () => {
  it('runs simple fixture to completion and returns pass verdict', async () => {
    const manifest = fixtureManifest('simple.manifest.yaml');
    const result = await run(manifest, { stream: false, slot: 'test-simple-1' });

    expect(result.resultVersion).toBe('testenv/v1/result');
    expect(result.verdict).toBe('pass');
    expect(result.repo).toBe('fixture-simple');
    expect(result.phases.length).toBeGreaterThan(0);
    expect(result.events.length).toBeGreaterThan(0);
  }, 30_000);

  it('skips phases 1-4 when all actions have needsStack=false (E3)', async () => {
    const manifest = fixtureManifest('simple.manifest.yaml');
    // All actions in simple fixture have needsStack: false
    const result = await run(manifest, { stream: false, slot: 'test-simple-e3' });

    // With needsStack=false, only test + teardown phases should run
    const phaseNames = result.phases.map((p) => p.phase);
    expect(phaseNames).toContain('test');
    expect(phaseNames).toContain('teardown');
    // setup/launch/await_ready/connection should NOT be present
    expect(phaseNames).not.toContain('setup');
    expect(phaseNames).not.toContain('launch');
    expect(phaseNames).not.toContain('await_ready');
    expect(phaseNames).not.toContain('connection');
  }, 30_000);

  it('result conforms to testenv/v1/result schema', async () => {
    const manifest = fixtureManifest('simple.manifest.yaml');
    const result = await run(manifest, { stream: false, slot: 'test-schema-1' });
    const validation = validateRunResult(result);
    expect(validation.ok).toBe(true);
  }, 30_000);

  it('includes all expected RunResult fields', async () => {
    const manifest = fixtureManifest('simple.manifest.yaml');
    const result = await run(manifest, {
      stream: false,
      slot: 'test-fields-1',
      profile: 'laptop',
      commit: 'abc123',
      branch: 'feature/test',
      runClass: 'green',
      specVersion: 'def456',
    });

    expect(result.profile).toBe('laptop');
    expect(result.commit).toBe('abc123');
    expect(result.branch).toBe('feature/test');
    expect(result.runClass).toBe('green');
    expect(result.specVersion).toBe('def456');
    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  }, 30_000);

  it('emits events for each phase', async () => {
    const manifest = fixtureManifest('simple.manifest.yaml');
    const result = await run(manifest, { stream: false, slot: 'test-events-1' });

    // Should have at least test and teardown events
    const phases = new Set(result.events.map((e) => e.phase));
    expect(phases.has('test')).toBe(true);
    expect(phases.has('teardown')).toBe(true);
  }, 30_000);
});

describe('runner — needsstack-false fixture', () => {
  it('all actions needsStack=false → only test + teardown phases run', async () => {
    const manifest = fixtureManifest('needsstack-false.manifest.yaml');
    const result = await run(manifest, { stream: false, slot: 'test-nostack-1' });

    expect(result.verdict).toBe('pass');
    const phaseNames = result.phases.map((p) => p.phase);
    expect(phaseNames).toEqual(['test', 'teardown']);
  }, 30_000);

  it('run-all policy: both actions pass', async () => {
    const manifest = fixtureManifest('needsstack-false.manifest.yaml');
    const result = await run(manifest, { stream: false, slot: 'test-runall-1' });

    expect(result.actions?.every((a) => a.status === 'pass')).toBe(true);
  }, 30_000);
});

describe('runner — fail-fast fixture', () => {
  it('stops after failed action and marks remaining as skip', async () => {
    const manifest = fixtureManifest('failfast.manifest.yaml');
    const result = await run(manifest, { stream: false, slot: 'test-failfast-1' });

    expect(result.verdict).toBe('fail');

    const actions = result.actions ?? [];
    const passFirst = actions.find((a) => a.name === 'pass-first');
    const failSecond = actions.find((a) => a.name === 'fail-second');
    const skipped = actions.find((a) => a.name === 'should-be-skipped');

    expect(passFirst?.status).toBe('pass');
    expect(failSecond?.status).toBe('fail');
    expect(skipped?.status).toBe('skip');
  }, 30_000);

  it('teardown always runs even when test phase fails', async () => {
    const manifest = fixtureManifest('failfast.manifest.yaml');
    const result = await run(manifest, { stream: false, slot: 'test-teardown-always-1' });

    const teardownPhase = result.phases.find((p) => p.phase === 'teardown');
    expect(teardownPhase).toBeDefined();
    expect(teardownPhase?.status).toBe('pass');
  }, 30_000);
});

describe('runner — secrets fixture', () => {
  it('aborts at setup when required secrets are missing', async () => {
    // Ensure the secret is NOT set
    delete process.env['TESTENV_REQUIRED_SECRET'];
    const manifest = fixtureManifest('with-secrets.manifest.yaml');
    const result = await run(manifest, { stream: false, slot: 'test-secrets-missing-1' });

    expect(result.verdict).toBe('fail');
    const setupPhase = result.phases.find((p) => p.phase === 'setup');
    expect(setupPhase?.status).toBe('fail');
    // Error is either from direct secret check or from isolation check (both are valid abort paths)
    expect(setupPhase?.error).toMatch(/secret|isolation/i);
  }, 30_000);

  it('proceeds when required secrets are present', async () => {
    process.env['TESTENV_REQUIRED_SECRET'] = 'test-value-xyz';
    const manifest = fixtureManifest('with-secrets.manifest.yaml');
    const result = await run(manifest, { stream: false, slot: 'test-secrets-present-1' });

    expect(result.verdict).toBe('pass');
    delete process.env['TESTENV_REQUIRED_SECRET'];
  }, 30_000);

  it('redacts secret values from event log', async () => {
    process.env['TESTENV_REQUIRED_SECRET'] = 'supersecretvalue999';
    const manifest = fixtureManifest('with-secrets.manifest.yaml');
    const result = await run(manifest, { stream: false, slot: 'test-secrets-redact-1' });

    const allMessages = result.events.map((e) => e.message).join('\n');
    expect(allMessages).not.toContain('supersecretvalue999');
    delete process.env['TESTENV_REQUIRED_SECRET'];
  }, 30_000);

  it('Phase-6 isolation checks run post-teardown', async () => {
    process.env['TESTENV_REQUIRED_SECRET'] = 'test-value-for-iso';
    const manifest = fixtureManifest('with-secrets.manifest.yaml');
    const result = await run(manifest, { stream: false, slot: 'test-iso-phase6-1' });

    const teardownPhase = result.phases.find((p) => p.phase === 'teardown');
    expect(teardownPhase).toBeDefined();
    expect(teardownPhase?.isolationChecks).toBeDefined();
    expect(teardownPhase?.isolationChecks?.every((c) => c.status === 'pass')).toBe(true);
    delete process.env['TESTENV_REQUIRED_SECRET'];
  }, 30_000);
});

describe('runner — concurrency', () => {
  it('respects concurrency=1 (serial execution)', async () => {
    const manifest = fixtureManifest('needsstack-false.manifest.yaml');
    const result = await run(manifest, { stream: false, slot: 'test-concurrency-1', concurrency: 1 });
    expect(result.verdict).toBe('pass');
    expect(result.actions?.length).toBe(2);
  }, 30_000);

  it('respects concurrency=10 (parallel execution)', async () => {
    const manifest = fixtureManifest('needsstack-false.manifest.yaml');
    const result = await run(manifest, { stream: false, slot: 'test-concurrency-10', concurrency: 10 });
    expect(result.verdict).toBe('pass');
  }, 30_000);
});

describe('runner — runClass', () => {
  it('defaults runClass to adhoc', async () => {
    const manifest = fixtureManifest('simple.manifest.yaml');
    const result = await run(manifest, { stream: false, slot: 'test-runclass-1' });
    expect(result.runClass).toBe('adhoc');
  }, 30_000);

  it('accepts all runClass values', async () => {
    const manifest = fixtureManifest('simple.manifest.yaml');
    for (const rc of ['red', 'green', 'regression', 'adhoc'] as const) {
      const result = await run(manifest, { stream: false, slot: `test-runclass-${rc}`, runClass: rc });
      expect(result.runClass).toBe(rc);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Validate schema of all fixture manifests
// ---------------------------------------------------------------------------

describe('fixture manifests — schema validation', () => {
  const fixtures = [
    'simple.manifest.yaml',
    'needsstack-false.manifest.yaml',
    'failfast.manifest.yaml',
    'with-secrets.manifest.yaml',
  ];

  for (const fixture of fixtures) {
    it(`validates ${fixture}`, () => {
      const manifest = fixtureManifest(fixture);
      // loadManifest already validates; re-check with validateManifest for explicit assertion
      const validation = validateManifest(manifest);
      expect(validation.ok).toBe(true);
    });
  }
});
