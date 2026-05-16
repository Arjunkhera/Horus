/**
 * testenv/v1 schema and validator unit tests
 *
 * Covers:
 * - Valid manifests (minimal and maximal examples)
 * - Invalid manifests with actionable error messages
 * - Each of the 6 phases
 * - Isolation invariant check definitions
 * - Test action flavors (command, tool, HTTP, sequence)
 * - Run result format
 * - Semantic validation rules
 */

import { describe, it, expect } from 'vitest';
import {
  validateManifest,
  validateRunResult,
  assertManifest,
  formatValidationErrors,
} from '../src/validator.js';
import type { Manifest, RunResult } from '../src/schema.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A minimal valid manifest — only required fields, sensible defaults.
 */
const MINIMAL_MANIFEST: unknown = {
  apiVersion: 'testenv/v1',
  repo: 'my-app',
  requires: {
    secrets: [],
  },
  phases: {
    setup: {
      steps: [{ run: 'npm install' }],
    },
    launch: {
      provisioner: 'docker compose up -d',
    },
    await_ready: {
      poll: [{ probe: 'GET :8080/health', expect: 'http_200' }],
    },
    connection: {
      emit: '{slot}/settings.json',
    },
    test: {
      actions: [
        {
          name: 'smoke-test',
          invoke: { run: 'curl -sf http://localhost:8080/health' },
          expect: { exitCode: 0 },
        },
      ],
    },
    teardown: {
      provisioner: 'docker compose down -v',
    },
  },
};

/**
 * A maximal manifest matching the Horus example from the design doc.
 */
const HORUS_MANIFEST: unknown = {
  apiVersion: 'testenv/v1',
  repo: 'horus',
  requires: {
    secrets: ['ANTHROPIC_API_KEY', 'CURSOR_API_KEY'],
    profiles: {
      laptop: { mem: '6g' },
      cloud: { mem: '12g' },
    },
  },
  phases: {
    setup: {
      steps: [
        { run: 'git clone --no-hardlinks {src} {workdir}' },
        { run: 'pnpm install && pnpm build' },
        { run: 'chown -R 1001:1001 {slot}/forge/{config,registry,workspaces,sessions}' },
        { run: 'git -C {slot}/registry init && chmod 777 {slot}/{neo4j,typesense}' },
      ],
      assert: [
        { type: 'path_exists', path: '{slot}/registry/.git' },
        { type: 'cmd_exit_zero', run: 'pnpm build' },
      ],
      isolationChecks: {
        disjointDockerProject: true,
        disjointDockerNetworks: true,
        disjointDockerVolumes: true,
        disjointPortSpace: true,
        disjointDataDir: true,
        allRequiredSecretsPresent: true,
      },
    },
    launch: {
      provisioner: 'horus test-env acquire --slot {slot} --standalone',
      assert: [
        { type: 'containers_running', count: 8 },
        { type: 'ports_disjoint_from_live', value: true },
        { type: 'docker_project_name', pattern: 'horus-test-{slot}' },
      ],
      isolationChecks: {
        distinctDockerProject: true,
        fullyProjectedPorts: true,
        connectionManifestEmitted: true,
      },
    },
    await_ready: {
      poll: [
        { probe: 'anvil_list_types', expect: 'returns_type_registry' },
        { probe: 'knowledge_get_schema', expect: 'returns_page_types' },
        { probe: 'forge_repo_list', expect: 'ok' },
        { probe: 'GET :{reader_port}', expect: 'http_200' },
      ],
      timeout: 180,
    },
    connection: {
      emit: '{slot}/claude-settings.json',
      assert: [
        { type: 'file_parses', path: '{slot}/claude-settings.json', format: 'json' },
        { type: 'mcp_names_suffixed', suffix: '-dev' },
      ],
    },
    test: {
      policy: 'fail-fast',
      actions: [
        {
          name: 'anvil-roundtrip',
          invoke: { tool: 'anvil_create_note', args: { title: 'check' } },
          expect: { returns: 'note_id' },
          evidence: { capture: 'response' },
          needsStack: true,
        },
        {
          name: 'isolation-proof',
          invoke: { http: 'live-anvil/search?q=check' },
          expect: { count: 0 },
          evidence: { capture: 'response', saveTo: 'isolation-proof.json' },
          needsStack: true,
        },
      ],
    },
    teardown: {
      provisioner: 'horus test-env release --slot {slot}',
      assert: [
        { type: 'containers_remaining', count: 0 },
        { type: 'live_stack_unmodified', value: true },
        { type: 'live_data_test_artifacts_zero', value: true },
        { type: 'no_secret_residue', value: true },
      ],
      isolationChecks: {
        liveStackUnmodified: true,
        liveDataTestArtifactsZero: true,
        noSecretResidue: true,
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Valid manifest tests
// ---------------------------------------------------------------------------

describe('validateManifest — valid manifests', () => {
  it('accepts a minimal valid manifest', () => {
    const result = validateManifest(MINIMAL_MANIFEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.apiVersion).toBe('testenv/v1');
      expect(result.data.repo).toBe('my-app');
    }
  });

  it('accepts the Horus example manifest (all 6 phases, full features)', () => {
    const result = validateManifest(HORUS_MANIFEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.repo).toBe('horus');
      expect(result.data.requires.secrets).toEqual(['ANTHROPIC_API_KEY', 'CURSOR_API_KEY']);
      expect(result.data.requires.profiles?.laptop.mem).toBe('6g');
      expect(result.data.phases.setup.steps).toHaveLength(4);
    }
  });

  it('defaults requires.secrets to empty array when not provided', () => {
    const input = {
      apiVersion: 'testenv/v1',
      repo: 'test-app',
      requires: {},
      phases: {
        ...((MINIMAL_MANIFEST as Record<string, unknown>).phases),
      },
    };
    const result = validateManifest(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.requires.secrets).toEqual([]);
    }
  });

  it('defaults await_ready.timeout to 180 and interval to 5', () => {
    const result = validateManifest(MINIMAL_MANIFEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.phases.await_ready.timeout).toBe(180);
      expect(result.data.phases.await_ready.interval).toBe(5);
    }
  });

  it('defaults test action needsStack to true', () => {
    const result = validateManifest(MINIMAL_MANIFEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.phases.test.actions[0].needsStack).toBe(true);
    }
  });

  it('defaults test phase policy to fail-fast', () => {
    const result = validateManifest(MINIMAL_MANIFEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.phases.test.policy).toBe('fail-fast');
    }
  });

  it('accepts test action with needsStack: false (stack-free inner loop)', () => {
    const input = {
      ...(MINIMAL_MANIFEST as object),
      phases: {
        ...((MINIMAL_MANIFEST as Record<string, unknown>).phases as object),
        test: {
          actions: [
            {
              name: 'type-check',
              invoke: { run: 'pnpm typecheck' },
              expect: { exitCode: 0 },
              needsStack: false,
            },
          ],
        },
      },
    };
    const result = validateManifest(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.phases.test.actions[0].needsStack).toBe(false);
    }
  });

  it('accepts a sequence invoke (flavor 3)', () => {
    const input = {
      ...(MINIMAL_MANIFEST as object),
      phases: {
        ...((MINIMAL_MANIFEST as Record<string, unknown>).phases as object),
        test: {
          actions: [
            {
              name: 'ordered-sequence',
              invoke: {
                sequence: [
                  {
                    name: 'step-1',
                    invoke: { run: 'echo hello' },
                    expect: { exitCode: 0 },
                  },
                  {
                    name: 'step-2',
                    invoke: { tool: 'some_tool', args: {} },
                    expect: { returns: 'ok' },
                  },
                ],
              },
            },
          ],
        },
      },
    };
    const result = validateManifest(input);
    expect(result.ok).toBe(true);
  });

  it('accepts all assertion types', () => {
    const assertions = [
      { type: 'path_exists', path: '/tmp/test' },
      { type: 'cmd_exit_zero', run: 'echo ok' },
      { type: 'containers_running', count: 3 },
      { type: 'containers_remaining', count: 0 },
      { type: 'ports_disjoint_from_live', value: true },
      { type: 'docker_project_name', pattern: 'my-test-{slot}' },
      { type: 'file_parses', path: '/tmp/config.json', format: 'json' },
      { type: 'env_vars_present', names: ['MY_SECRET'] },
      { type: 'live_stack_unmodified', value: true },
      { type: 'live_data_test_artifacts_zero', value: true },
      { type: 'no_secret_residue', value: true },
      { type: 'mcp_names_suffixed', suffix: '-dev' },
      { type: 'fully_projected_ports', value: true },
      { type: 'http_ok', url: 'http://localhost:8080/health' },
    ];

    for (const assertion of assertions) {
      const input = {
        ...(MINIMAL_MANIFEST as object),
        phases: {
          ...((MINIMAL_MANIFEST as Record<string, unknown>).phases as object),
          setup: {
            steps: [{ run: 'echo ok' }],
            assert: [assertion],
          },
        },
      };
      const result = validateManifest(input);
      expect(result.ok, `assertion type "${assertion.type}" should be valid`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Invalid manifest tests
// ---------------------------------------------------------------------------

describe('validateManifest — invalid manifests', () => {
  it('rejects missing apiVersion', () => {
    const input = { repo: 'test', requires: {}, phases: (MINIMAL_MANIFEST as Record<string, unknown>).phases };
    const result = validateManifest(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path.includes('apiVersion'))).toBe(true);
    }
  });

  it('rejects wrong apiVersion', () => {
    const input = { ...MINIMAL_MANIFEST as object, apiVersion: 'testenv/v2' };
    const result = validateManifest(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.path.includes('apiVersion'));
      expect(err).toBeDefined();
      expect(err!.message).toContain('testenv/v1');
    }
  });

  it('rejects missing repo', () => {
    const { repo: _, ...withoutRepo } = MINIMAL_MANIFEST as Record<string, unknown>;
    const result = validateManifest(withoutRepo);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'repo')).toBe(true);
    }
  });

  it('rejects missing phases', () => {
    const input = { apiVersion: 'testenv/v1', repo: 'test', requires: {} };
    const result = validateManifest(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path.includes('phases'))).toBe(true);
    }
  });

  it('rejects setup phase with no steps', () => {
    const input = {
      ...(MINIMAL_MANIFEST as object),
      phases: {
        ...((MINIMAL_MANIFEST as Record<string, unknown>).phases as object),
        setup: { steps: [] },
      },
    };
    const result = validateManifest(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.path.includes('setup') && e.path.includes('steps'));
      expect(err).toBeDefined();
      expect(err!.message).toMatch(/at least 1/i);
    }
  });

  it('rejects test phase with no actions', () => {
    const input = {
      ...(MINIMAL_MANIFEST as object),
      phases: {
        ...((MINIMAL_MANIFEST as Record<string, unknown>).phases as object),
        test: { actions: [] },
      },
    };
    const result = validateManifest(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.path.includes('actions'));
      expect(err).toBeDefined();
    }
  });

  it('rejects await_ready with no probes', () => {
    const input = {
      ...(MINIMAL_MANIFEST as object),
      phases: {
        ...((MINIMAL_MANIFEST as Record<string, unknown>).phases as object),
        await_ready: { poll: [] },
      },
    };
    const result = validateManifest(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.path.includes('poll'));
      expect(err).toBeDefined();
    }
  });

  it('rejects invalid mem format in profile', () => {
    const input = {
      ...(MINIMAL_MANIFEST as object),
      requires: {
        secrets: [],
        profiles: {
          laptop: { mem: '6GB' }, // wrong: should be '6g'
        },
      },
    };
    const result = validateManifest(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.path.includes('mem'));
      expect(err).toBeDefined();
      expect(err!.message).toContain('6g');
    }
  });

  it('rejects invalid enum for test.policy', () => {
    const input = {
      ...(MINIMAL_MANIFEST as object),
      phases: {
        ...((MINIMAL_MANIFEST as Record<string, unknown>).phases as object),
        test: {
          policy: 'continue-on-error', // invalid
          actions: [
            {
              name: 'test-1',
              invoke: { run: 'echo ok' },
            },
          ],
        },
      },
    };
    const result = validateManifest(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.path.includes('policy'));
      expect(err).toBeDefined();
      expect(err!.message).toContain('fail-fast');
      expect(err!.message).toContain('run-all');
    }
  });

  it('provides actionable message for wrong apiVersion', () => {
    const input = { ...MINIMAL_MANIFEST as object, apiVersion: 'v1' };
    const result = validateManifest(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors[0];
      expect(err.message).toContain('testenv/v1');
      // Should be case-sensitive guidance
      expect(err.message).toContain('case-sensitive');
    }
  });

  it('provides actionable message for empty command string', () => {
    const input = {
      ...(MINIMAL_MANIFEST as object),
      phases: {
        ...((MINIMAL_MANIFEST as Record<string, unknown>).phases as object),
        setup: { steps: [{ run: '' }] },
      },
    };
    const result = validateManifest(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.path.includes('run'));
      expect(err).toBeDefined();
      expect(err!.message).toMatch(/empty/i);
    }
  });

  it('rejects completely non-object input', () => {
    const result = validateManifest('not-an-object');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].path).toBe('<root>');
    }
  });

  it('rejects null input', () => {
    const result = validateManifest(null);
    expect(result.ok).toBe(false);
  });

  it('rejects unknown assertion type', () => {
    const input = {
      ...(MINIMAL_MANIFEST as object),
      phases: {
        ...((MINIMAL_MANIFEST as Record<string, unknown>).phases as object),
        setup: {
          steps: [{ run: 'echo ok' }],
          assert: [{ type: 'unknown_assertion', value: true }],
        },
      },
    };
    const result = validateManifest(input);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Semantic validation tests
// ---------------------------------------------------------------------------

describe('validateManifest — semantic validation', () => {
  it('rejects duplicate test action names', () => {
    const input = {
      ...(MINIMAL_MANIFEST as object),
      phases: {
        ...((MINIMAL_MANIFEST as Record<string, unknown>).phases as object),
        test: {
          actions: [
            { name: 'duplicate', invoke: { run: 'echo 1' } },
            { name: 'duplicate', invoke: { run: 'echo 2' } },
          ],
        },
      },
    };
    const result = validateManifest(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.message.includes('duplicate'));
      expect(err).toBeDefined();
      expect(err!.message).toContain('"duplicate"');
      expect(err!.message).toContain('unique');
    }
  });

  it('rejects launch phase with neither steps nor provisioner', () => {
    const input = {
      ...(MINIMAL_MANIFEST as object),
      phases: {
        ...((MINIMAL_MANIFEST as Record<string, unknown>).phases as object),
        launch: {},
      },
    };
    const result = validateManifest(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.path.includes('launch'));
      expect(err).toBeDefined();
      expect(err!.message).toContain('provisioner');
    }
  });
});

// ---------------------------------------------------------------------------
// assertManifest tests
// ---------------------------------------------------------------------------

describe('assertManifest', () => {
  it('returns the manifest when valid', () => {
    const manifest = assertManifest(MINIMAL_MANIFEST);
    expect(manifest.apiVersion).toBe('testenv/v1');
  });

  it('throws with all errors when invalid', () => {
    expect(() => assertManifest({ apiVersion: 'wrong', repo: '' })).toThrow(
      /testenv\/v1 manifest validation failed/,
    );
  });

  it('includes path and message in thrown error', () => {
    let thrown: Error | undefined;
    try {
      assertManifest({ apiVersion: 'testenv/v2', repo: 'test' });
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain('[apiVersion]');
    expect(thrown!.message).toContain('testenv/v1');
  });
});

// ---------------------------------------------------------------------------
// formatValidationErrors
// ---------------------------------------------------------------------------

describe('formatValidationErrors', () => {
  it('formats errors with numbered list and paths', () => {
    const input = { apiVersion: 'wrong', repo: '' };
    const result = validateManifest(input);
    if (!result.ok) {
      const formatted = formatValidationErrors(result.errors);
      expect(formatted).toContain('1.');
      expect(formatted).toContain('[');
      expect(formatted).toContain(']');
    }
  });
});

// ---------------------------------------------------------------------------
// Run result validation tests
// ---------------------------------------------------------------------------

describe('validateRunResult', () => {
  const VALID_RESULT: RunResult = {
    resultVersion: 'testenv/v1/result',
    verdict: 'pass',
    repo: 'my-app',
    profile: 'laptop',
    commit: 'abc123',
    branch: 'feature/my-feature',
    slot: 'slot-01',
    startedAt: '2024-01-15T12:00:00.000Z',
    endedAt: '2024-01-15T12:05:00.000Z',
    totalDurationMs: 300000,
    phases: [
      {
        phase: 'setup',
        status: 'pass',
        durationMs: 30000,
      },
    ],
    actions: [
      {
        name: 'smoke-test',
        status: 'pass',
        durationMs: 1500,
        expected: '0',
        actual: '0',
      },
    ],
    events: [
      {
        ts: '2024-01-15T12:00:00.000Z',
        severity: 'info',
        phase: 'setup',
        message: 'Setup started',
      },
    ],
    runClass: 'green',
    specVersion: 'def456',
    meta: { storyId: '51993236' },
  };

  it('accepts a valid run result', () => {
    const result = validateRunResult(VALID_RESULT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.verdict).toBe('pass');
      expect(result.data.runClass).toBe('green');
    }
  });

  it('defaults runClass to adhoc', () => {
    const { runClass: _, ...withoutClass } = VALID_RESULT;
    const result = validateRunResult(withoutClass);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.runClass).toBe('adhoc');
    }
  });

  it('rejects wrong resultVersion', () => {
    const input = { ...VALID_RESULT, resultVersion: 'testenv/v1/wrong' };
    const result = validateRunResult(input);
    expect(result.ok).toBe(false);
  });

  it('rejects invalid verdict', () => {
    const input = { ...VALID_RESULT, verdict: 'unknown' };
    const result = validateRunResult(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.path.includes('verdict'));
      expect(err).toBeDefined();
      expect(err!.message).toContain('pass');
    }
  });

  it('rejects invalid datetime format in startedAt', () => {
    const input = { ...VALID_RESULT, startedAt: '2024-01-15 12:00:00' };
    const result = validateRunResult(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.path.includes('startedAt'));
      expect(err).toBeDefined();
      expect(err!.message).toContain('ISO-8601');
    }
  });

  it('rejects negative durationMs', () => {
    const input = { ...VALID_RESULT, totalDurationMs: -1 };
    const result = validateRunResult(input);
    expect(result.ok).toBe(false);
  });

  it('accepts all runClass values', () => {
    for (const runClass of ['red', 'green', 'regression', 'adhoc'] as const) {
      const input = { ...VALID_RESULT, runClass };
      const result = validateRunResult(input);
      expect(result.ok, `runClass "${runClass}" should be valid`).toBe(true);
    }
  });

  it('accepts all verdict values', () => {
    for (const verdict of ['pass', 'fail', 'skip', 'error'] as const) {
      const input = { ...VALID_RESULT, verdict };
      const result = validateRunResult(input);
      expect(result.ok, `verdict "${verdict}" should be valid`).toBe(true);
    }
  });

  it('accepts all event severity values', () => {
    for (const severity of ['debug', 'info', 'warn', 'error'] as const) {
      const input = {
        ...VALID_RESULT,
        events: [{ ...VALID_RESULT.events[0], severity }],
      };
      const result = validateRunResult(input);
      expect(result.ok, `severity "${severity}" should be valid`).toBe(true);
    }
  });

  it('accepts all phase identifiers', () => {
    for (const phase of ['setup', 'launch', 'await_ready', 'connection', 'test', 'teardown'] as const) {
      const input = {
        ...VALID_RESULT,
        events: [{ ...VALID_RESULT.events[0], phase }],
      };
      const result = validateRunResult(input);
      expect(result.ok, `phase "${phase}" should be valid`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Isolation invariant check structure tests
// ---------------------------------------------------------------------------

describe('isolation invariant checks', () => {
  it('accepts Phase-1 preventive checks on setup phase', () => {
    const result = validateManifest(HORUS_MANIFEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const checks = result.data.phases.setup.isolationChecks!;
      expect(checks.disjointDockerProject).toBe(true);
      expect(checks.disjointDockerNetworks).toBe(true);
      expect(checks.disjointDockerVolumes).toBe(true);
      expect(checks.disjointPortSpace).toBe(true);
      expect(checks.disjointDataDir).toBe(true);
      expect(checks.allRequiredSecretsPresent).toBe(true);
    }
  });

  it('accepts Phase-2 structural checks on launch phase', () => {
    const result = validateManifest(HORUS_MANIFEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const checks = result.data.phases.launch.isolationChecks!;
      expect(checks.distinctDockerProject).toBe(true);
      expect(checks.fullyProjectedPorts).toBe(true);
      expect(checks.connectionManifestEmitted).toBe(true);
    }
  });

  it('accepts Phase-6 detective checks on teardown phase', () => {
    const result = validateManifest(HORUS_MANIFEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const checks = result.data.phases.teardown.isolationChecks!;
      expect(checks.liveStackUnmodified).toBe(true);
      expect(checks.liveDataTestArtifactsZero).toBe(true);
      expect(checks.noSecretResidue).toBe(true);
    }
  });

  it('isolation checks are optional (manifest valid without them)', () => {
    const result = validateManifest(MINIMAL_MANIFEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.phases.setup.isolationChecks).toBeUndefined();
      expect(result.data.phases.launch.isolationChecks).toBeUndefined();
      expect(result.data.phases.teardown.isolationChecks).toBeUndefined();
    }
  });

  it('defaults Phase-1 checks to all true when isolation block is present', () => {
    const input = {
      ...(MINIMAL_MANIFEST as object),
      phases: {
        ...((MINIMAL_MANIFEST as Record<string, unknown>).phases as object),
        setup: {
          steps: [{ run: 'echo ok' }],
          isolationChecks: {}, // all defaults
        },
      },
    };
    const result = validateManifest(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const checks = result.data.phases.setup.isolationChecks!;
      expect(checks.disjointDockerProject).toBe(true);
      expect(checks.allRequiredSecretsPresent).toBe(true);
    }
  });
});
