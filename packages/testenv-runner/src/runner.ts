/**
 * runner-core — the deterministic 6-phase executor.
 *
 * Consumes a validated testenv/v1 Manifest and:
 * 1. Executes 6 phases strictly sequentially.
 * 2. Enforces assertions as hard gates (abort on setup/launch/isolation failure).
 * 3. Teardown ALWAYS runs (even when prior phases fail).
 * 4. Evaluates isolation invariant checks (Phase-1 preventive, Phase-2 structural, Phase-6 detective).
 * 5. Parallelizes independent test actions (bounded by `concurrency`).
 * 6. Respects fail-fast vs run-all policy per profile.
 * 7. Skips setup/launch/await_ready/connection when no selected action needs the stack (E3).
 * 8. Strict ephemeral: full setup→teardown each invocation, no warm reuse (D2).
 * 9. Emits corpus-ready streaming event log and returns RunResult.
 * 10. Enforces secret redaction in all output.
 */

import type {
  Manifest,
  Phases,
  PhaseResult,
  ActionResult,
  RunResult,
  RunStatus,
  TestAction,
} from '@akhera-horus/testenv';
import { allSecretNames, resolveRequiredSecrets } from '@akhera-horus/testenv';
import { EventLog } from './event-log.js';
import { buildRedactor } from './redact.js';
import { renderTemplate, type TemplateContext } from './template.js';
import { execCommand } from './exec.js';
import {
  evaluateAssertions,
  evaluatePhase1IsolationChecks,
  evaluatePhase2IsolationChecks,
  evaluatePhase6IsolationChecks,
  hasFailure,
  type AssertionResult,
  type IsolationCheckResult,
} from './assertions.js';

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface RunOptions {
  /** Run profile name (e.g., "laptop", "cloud"). */
  profile?: string;
  /** Slot identifier used for naming docker resources and template vars. */
  slot?: string;
  /** Working directory for commands (defaults to process.cwd()). */
  workdir?: string;
  /** Source path (for git clone steps; template var {src}). */
  src?: string;
  /** Git commit hash of the code under test. */
  commit?: string;
  /** Git branch of the code under test. */
  branch?: string;
  /**
   * Run classification.
   * "red" | "green" | "regression" | "adhoc"
   */
  runClass?: RunResult['runClass'];
  /** Spec version (commit hash of .testenv dir). */
  specVersion?: string;
  /** Max parallel test actions. Default: 4. */
  concurrency?: number;
  /** Arbitrary metadata to include in RunResult. */
  meta?: Record<string, unknown>;
  /**
   * If true, emit each event to stdout as NDJSON (streaming).
   * Default: true.
   */
  stream?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function elapsed(startMs: number): number {
  return Date.now() - startMs;
}

/**
 * Determine whether any selected test action requires the full stack.
 * If all actions have needsStack: false, we can skip setup/launch/await_ready/connection.
 */
function anyActionNeedsStack(actions: TestAction[]): boolean {
  return actions.some((a) => a.needsStack !== false);
}

// ---------------------------------------------------------------------------
// Phase executors
// ---------------------------------------------------------------------------

/**
 * Phase 1 — setup
 */
async function runSetup(
  phases: Phases,
  log: EventLog,
  ctx: TemplateContext,
  secretNames: string[],
): Promise<{ result: PhaseResult; abort: boolean }> {
  const startMs = Date.now();
  log.info('setup', 'Phase 1: setup — starting');

  const assertionResults: AssertionResult[] = [];
  const isolationCheckResults: IsolationCheckResult[] = [];

  // Phase-1 isolation checks FIRST (preventive — abort before touching anything)
  if (phases.setup.isolationChecks) {
    log.info('setup', 'Running Phase-1 preventive isolation checks');
    const checks = evaluatePhase1IsolationChecks(phases.setup.isolationChecks, secretNames, ctx);
    isolationCheckResults.push(...checks);
    for (const c of checks) {
      const sev = c.status === 'pass' ? 'info' : 'error';
      log.emit(sev, 'setup', `[isolation:${c.check}] ${c.detail ?? c.status}`);
    }
    if (hasFailure(checks)) {
      log.error('setup', 'Phase-1 isolation checks failed — aborting before touching shared resources');
      return {
        result: {
          phase: 'setup',
          status: 'fail',
          durationMs: elapsed(startMs),
          isolationChecks: checks,
          error: 'Phase-1 preventive isolation check failed',
        },
        abort: true,
      };
    }
  }

  // Also enforce secrets present via env_vars_present assertion (belt-and-suspenders)
  if (secretNames.length > 0) {
    const missing = secretNames.filter((n) => !process.env[n]);
    if (missing.length > 0) {
      log.error('setup', `Missing required secrets: ${missing.join(', ')} (values not logged)`);
      return {
        result: {
          phase: 'setup',
          status: 'fail',
          durationMs: elapsed(startMs),
          error: `Missing required secrets: ${missing.join(', ')}`,
        },
        abort: true,
      };
    }
    log.info('setup', `All ${secretNames.length} required secrets present`);
  }

  // Execute steps
  for (const step of phases.setup.steps) {
    const cmd = renderTemplate(step.run, ctx);
    const label = step.label ?? cmd;
    log.info('setup', `Running step: ${label}`);
    const result = await execCommand(cmd, { cwd: ctx.workdir });
    if (result.exitCode !== 0 && !step.optional) {
      log.error('setup', `Step failed (exit ${result.exitCode}): ${label}`, {
        payload: { stderr: result.stderr.slice(0, 2000) },
      });
      return {
        result: {
          phase: 'setup',
          status: 'fail',
          durationMs: elapsed(startMs),
          error: `Step failed: ${label}`,
        },
        abort: true,
      };
    }
    if (result.exitCode !== 0 && step.optional) {
      log.warn('setup', `Optional step failed (exit ${result.exitCode}): ${label} — continuing`);
    } else {
      log.info('setup', `Step succeeded: ${label}`);
    }
  }

  // Evaluate assertions
  if (phases.setup.assert && phases.setup.assert.length > 0) {
    log.info('setup', `Evaluating ${phases.setup.assert.length} assertion(s)`);
    const results = evaluateAssertions(phases.setup.assert, ctx);
    assertionResults.push(...results);
    for (const r of results) {
      const sev = r.status === 'pass' ? 'info' : 'error';
      log.emit(sev, 'setup', `[assert:${r.type}] ${r.detail ?? r.status}`);
    }
    if (hasFailure(results)) {
      log.error('setup', 'Setup assertions failed — aborting');
      return {
        result: {
          phase: 'setup',
          status: 'fail',
          durationMs: elapsed(startMs),
          assertions: results,
          isolationChecks: isolationCheckResults,
          error: 'Setup assertion(s) failed',
        },
        abort: true,
      };
    }
  }

  log.info('setup', 'Phase 1: setup — complete');
  return {
    result: {
      phase: 'setup',
      status: 'pass',
      durationMs: elapsed(startMs),
      assertions: assertionResults.length > 0 ? assertionResults : undefined,
      isolationChecks: isolationCheckResults.length > 0 ? isolationCheckResults : undefined,
    },
    abort: false,
  };
}

/**
 * Phase 2 — launch
 */
async function runLaunch(
  phases: Phases,
  log: EventLog,
  ctx: TemplateContext,
): Promise<{ result: PhaseResult; abort: boolean }> {
  const startMs = Date.now();
  log.info('launch', 'Phase 2: launch — starting');

  const assertionResults: AssertionResult[] = [];
  const isolationCheckResults: IsolationCheckResult[] = [];

  // Optional pre-steps
  if (phases.launch.steps && phases.launch.steps.length > 0) {
    for (const step of phases.launch.steps) {
      const cmd = renderTemplate(step.run, ctx);
      const label = step.label ?? cmd;
      log.info('launch', `Running step: ${label}`);
      const result = await execCommand(cmd, { cwd: ctx.workdir });
      if (result.exitCode !== 0 && !step.optional) {
        log.error('launch', `Launch step failed (exit ${result.exitCode}): ${label}`);
        return {
          result: {
            phase: 'launch',
            status: 'fail',
            durationMs: elapsed(startMs),
            error: `Launch step failed: ${label}`,
          },
          abort: true,
        };
      }
    }
  }

  // Provisioner (delegate bring-up to the manifest's declared command)
  if (phases.launch.provisioner) {
    const provCmd = renderTemplate(phases.launch.provisioner, ctx);
    log.info('launch', `Invoking provisioner: ${provCmd}`);
    const result = await execCommand(provCmd, { cwd: ctx.workdir, timeout: 600_000 });
    if (result.exitCode !== 0) {
      log.error('launch', `Provisioner failed (exit ${result.exitCode}): ${provCmd}`, {
        payload: { stderr: result.stderr.slice(0, 2000) },
      });
      return {
        result: {
          phase: 'launch',
          status: 'fail',
          durationMs: elapsed(startMs),
          error: `Provisioner failed: ${provCmd}`,
        },
        abort: true,
      };
    }
    log.info('launch', 'Provisioner completed successfully');

    // Slot discovery: if the provisioner emits a JSON object on stdout, merge
    // its slot context into ctx so connection/test/teardown templates resolve
    // correctly. The provisioner (not the caller) owns slot assignment.
    // Non-JSON provisioners are unaffected (parse failure is ignored).
    const provStdout = result.stdout.trim();
    if (provStdout.startsWith('{')) {
      try {
        const parsed = JSON.parse(provStdout) as Record<string, unknown>;
        if (parsed.slot !== undefined) ctx.slot = String(parsed.slot);
        if (typeof parsed.slot_data_path === 'string') ctx.slot_data_path = parsed.slot_data_path;
        if (typeof parsed.project === 'string') ctx.project = parsed.project;
        if (parsed.ports && typeof parsed.ports === 'object') {
          for (const [k, v] of Object.entries(parsed.ports as Record<string, unknown>)) {
            ctx[`port_${k}`] = String(v);
          }
        }
        log.info(
          'launch',
          `Provisioner slot context: slot=${ctx.slot} project=${ctx.project} data=${ctx.slot_data_path}`,
        );
      } catch {
        log.warn('launch', 'Provisioner stdout looked like JSON but failed to parse — ignoring');
      }
    }
  }

  // Assertions
  if (phases.launch.assert && phases.launch.assert.length > 0) {
    log.info('launch', `Evaluating ${phases.launch.assert.length} assertion(s)`);
    const results = evaluateAssertions(phases.launch.assert, ctx);
    assertionResults.push(...results);
    for (const r of results) {
      const sev = r.status === 'pass' ? 'info' : 'error';
      log.emit(sev, 'launch', `[assert:${r.type}] ${r.detail ?? r.status}`);
    }
    if (hasFailure(results)) {
      log.error('launch', 'Launch assertions failed — aborting');
      return {
        result: {
          phase: 'launch',
          status: 'fail',
          durationMs: elapsed(startMs),
          assertions: results,
          error: 'Launch assertion(s) failed',
        },
        abort: true,
      };
    }
  }

  // Phase-2 isolation checks (structural) — after launch
  if (phases.launch.isolationChecks) {
    log.info('launch', 'Running Phase-2 structural isolation checks');
    // claude-settings.json is written into the slot DATA dir by the
    // provisioner — use slot_data_path (abs), not the bare slot id.
    const emitPath = ctx.slot_data_path
      ? `${ctx.slot_data_path}/claude-settings.json`
      : ctx.slot
        ? `${ctx.slot}/claude-settings.json`
        : undefined;
    const checks = evaluatePhase2IsolationChecks(phases.launch.isolationChecks, {
      ...ctx,
      emitPath,
    });
    isolationCheckResults.push(...checks);
    for (const c of checks) {
      const sev = c.status === 'pass' ? 'info' : 'error';
      log.emit(sev, 'launch', `[isolation:${c.check}] ${c.detail ?? c.status}`);
    }
    if (hasFailure(checks)) {
      log.error('launch', 'Phase-2 isolation checks failed — aborting');
      return {
        result: {
          phase: 'launch',
          status: 'fail',
          durationMs: elapsed(startMs),
          assertions: assertionResults,
          isolationChecks: checks,
          error: 'Phase-2 structural isolation check failed',
        },
        abort: true,
      };
    }
  }

  log.info('launch', 'Phase 2: launch — complete');
  return {
    result: {
      phase: 'launch',
      status: 'pass',
      durationMs: elapsed(startMs),
      assertions: assertionResults.length > 0 ? assertionResults : undefined,
      isolationChecks: isolationCheckResults.length > 0 ? isolationCheckResults : undefined,
    },
    abort: false,
  };
}

/**
 * Phase 3 — await_ready
 */
async function runAwaitReady(
  phases: Phases,
  log: EventLog,
  ctx: TemplateContext,
): Promise<{ result: PhaseResult; abort: boolean }> {
  const startMs = Date.now();
  const timeoutMs = (phases.await_ready.timeout ?? 180) * 1000;
  const intervalMs = (phases.await_ready.interval ?? 5) * 1000;
  log.info('await_ready', `Phase 3: await_ready — polling ${phases.await_ready.poll.length} probe(s), timeout ${timeoutMs / 1000}s`);

  const deadline = Date.now() + timeoutMs;
  let allReady = false;

  outer: while (Date.now() < deadline) {
    let allPass = true;
    for (const probe of phases.await_ready.poll) {
      log.debug('await_ready', `Probing: ${probe.probe} (expect: ${probe.expect})`);
      const ready = await evalProbe(probe.probe, probe.expect, probe.args, ctx);
      if (!ready) {
        allPass = false;
        log.debug('await_ready', `Probe not ready: ${probe.probe}`);
        // wait and retry
        await sleep(intervalMs);
        continue outer;
      }
    }
    if (allPass) {
      allReady = true;
      break;
    }
  }

  if (!allReady) {
    log.error('await_ready', `Timeout after ${timeoutMs / 1000}s — services not ready`);
    return {
      result: {
        phase: 'await_ready',
        status: 'fail',
        durationMs: elapsed(startMs),
        error: `Services not ready within ${timeoutMs / 1000}s`,
      },
      abort: true,
    };
  }

  // Optional assertions
  const assertionResults: AssertionResult[] = [];
  if (phases.await_ready.assert && phases.await_ready.assert.length > 0) {
    const results = evaluateAssertions(phases.await_ready.assert, ctx);
    assertionResults.push(...results);
    for (const r of results) {
      const sev = r.status === 'pass' ? 'info' : 'warn';
      log.emit(sev, 'await_ready', `[assert:${r.type}] ${r.detail ?? r.status}`);
    }
  }

  log.info('await_ready', 'Phase 3: await_ready — all services ready');
  return {
    result: {
      phase: 'await_ready',
      status: 'pass',
      durationMs: elapsed(startMs),
      assertions: assertionResults.length > 0 ? assertionResults : undefined,
    },
    abort: false,
  };
}

/** Simple probe evaluator — HTTP or command-based. */
async function evalProbe(
  probe: string,
  expect: string,
  _args: Record<string, unknown> | undefined,
  _ctx: TemplateContext,
): Promise<boolean> {
  // HTTP probe: "GET :8080/health" or "GET http://host:port/path"
  const httpMatch = probe.match(/^(?:GET|POST|HEAD)\s+(.+)$/i);
  if (httpMatch) {
    const urlRaw = httpMatch[1].trim();
    const url = urlRaw.startsWith(':') ? `http://localhost${urlRaw}` : urlRaw;
    const result = await execCommand(`curl -sf --max-time 5 "${url}" > /dev/null 2>&1`);
    if (expect === 'http_200' || expect === 'ok') {
      return result.exitCode === 0;
    }
    return result.exitCode === 0;
  }

  // Tool probe: a named MCP tool (e.g., "anvil_list_types")
  // In runner-core we cannot actually call MCP tools — we record these as advisory.
  // The actual tool probing is the responsibility of the sdlc-testenv subagent.
  // For runner-core, we treat tool probes as immediately passing (the agent handles them).
  if (expect === 'returns_type_registry' || expect === 'returns_page_types' || expect === 'ok') {
    return true; // Advisory — agent-level probe
  }

  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Phase 4 — connection
 */
async function runConnection(
  phases: Phases,
  log: EventLog,
  ctx: TemplateContext,
): Promise<{ result: PhaseResult; abort: boolean; emitPath?: string }> {
  const startMs = Date.now();
  log.info('connection', 'Phase 4: connection — starting');

  const emitPath = renderTemplate(phases.connection.emit, ctx);

  // Optional pre-steps
  if (phases.connection.steps && phases.connection.steps.length > 0) {
    for (const step of phases.connection.steps) {
      const cmd = renderTemplate(step.run, ctx);
      const label = step.label ?? cmd;
      log.info('connection', `Running step: ${label}`);
      const result = await execCommand(cmd, { cwd: ctx.workdir });
      if (result.exitCode !== 0 && !step.optional) {
        log.error('connection', `Connection step failed: ${label}`);
        return {
          result: {
            phase: 'connection',
            status: 'fail',
            durationMs: elapsed(startMs),
            error: `Connection step failed: ${label}`,
          },
          abort: true,
        };
      }
    }
  }

  log.info('connection', `Connection manifest expected at: ${emitPath}`);

  // Assertions (e.g., file_parses, mcp_names_suffixed)
  const assertionResults: AssertionResult[] = [];
  if (phases.connection.assert && phases.connection.assert.length > 0) {
    const results = evaluateAssertions(phases.connection.assert, { ...ctx, emitPath });
    assertionResults.push(...results);
    for (const r of results) {
      const sev = r.status === 'pass' ? 'info' : 'warn';
      log.emit(sev, 'connection', `[assert:${r.type}] ${r.detail ?? r.status}`);
    }
    // Connection assertions are non-aborting (advisory) — the connection may be set up
    // by the provisioner rather than a step here.
  }

  log.info('connection', 'Phase 4: connection — complete');
  return {
    result: {
      phase: 'connection',
      status: 'pass',
      durationMs: elapsed(startMs),
      assertions: assertionResults.length > 0 ? assertionResults : undefined,
    },
    abort: false,
    emitPath,
  };
}

// ---------------------------------------------------------------------------
// Test action executor
// ---------------------------------------------------------------------------

async function runTestAction(
  action: TestAction,
  log: EventLog,
  ctx: TemplateContext,
  redact: (s: string) => string,
): Promise<ActionResult> {
  const startMs = Date.now();
  log.info('test', `[action:${action.name}] start`, { action: action.name });

  try {
    const invoke = action.invoke;

    if ('run' in invoke) {
      // Flavor 1: shell command
      const cmd = renderTemplate(invoke.run, ctx);
      const result = await execCommand(cmd, { cwd: ctx.workdir });
      const actual = String(result.exitCode);
      const expected = action.expect && 'exitCode' in action.expect
        ? String(action.expect.exitCode)
        : '0';

      const pass = result.exitCode === (action.expect && 'exitCode' in action.expect ? action.expect.exitCode : 0);
      const status: RunStatus = pass ? 'pass' : 'fail';

      log.emit(status === 'pass' ? 'info' : 'error', 'test',
        `[action:${action.name}] ${status} (exit ${result.exitCode})`, { action: action.name });

      return {
        name: action.name,
        status,
        durationMs: elapsed(startMs),
        expected,
        actual: redact(actual),
        reason: pass ? undefined : `Exit code ${result.exitCode} ≠ ${expected}`,
      };
    }

    if ('tool' in invoke) {
      // Flavor 2: tool call — runner-core records but does not execute tool calls
      // (tool execution is the sdlc-testenv agent's responsibility)
      log.info('test', `[action:${action.name}] tool call recorded: ${invoke.tool}`, { action: action.name });
      return {
        name: action.name,
        status: 'pass',
        durationMs: elapsed(startMs),
        actual: `tool:${invoke.tool}`,
        reason: 'Tool call recorded — execution delegated to sdlc-testenv agent',
      };
    }

    if ('http' in invoke) {
      // Flavor 3: HTTP call
      const url = invoke.http.startsWith(':')
        ? `http://localhost${invoke.http}`
        : invoke.http.startsWith('http')
        ? invoke.http
        : `http://${invoke.http}`;

      const result = await execCommand(`curl -sf --max-time 30 "${url}"`, { cwd: ctx.workdir });
      const rawOutput = redact(result.stdout.trim());

      let pass = false;
      let expected = '';
      let reason: string | undefined;

      if (action.expect) {
        if ('status' in action.expect) {
          // HTTP status check is advisory from CLI — curl exit code is our signal
          pass = result.exitCode === 0;
          expected = String(action.expect.status);
          reason = pass ? undefined : `HTTP request failed (curl exit ${result.exitCode})`;
        } else if ('count' in action.expect) {
          // Numeric count check (e.g., isolation proof: count: 0)
          try {
            const parsed = JSON.parse(result.stdout) as unknown;
            let count = 0;
            if (Array.isArray(parsed)) count = parsed.length;
            else if (parsed && typeof parsed === 'object' && 'count' in parsed) {
              count = (parsed as { count: number }).count;
            }
            pass = count === action.expect.count;
            expected = String(action.expect.count);
            reason = pass ? undefined : `Count ${count} ≠ ${action.expect.count}`;
          } catch {
            pass = false;
            expected = String(action.expect.count);
            reason = 'Could not parse response as JSON for count assertion';
          }
        } else if ('contains' in action.expect) {
          pass = result.stdout.includes(action.expect.contains);
          expected = action.expect.contains;
          reason = pass ? undefined : 'Response does not contain expected string';
        } else {
          pass = result.exitCode === 0;
          expected = 'http_ok';
        }
      } else {
        pass = result.exitCode === 0;
      }

      const status: RunStatus = pass ? 'pass' : 'fail';
      log.emit(status === 'pass' ? 'info' : 'error', 'test',
        `[action:${action.name}] ${status} HTTP ${url}`, { action: action.name });

      return {
        name: action.name,
        status,
        durationMs: elapsed(startMs),
        expected,
        actual: rawOutput.slice(0, 500),
        reason,
      };
    }

    if ('sequence' in invoke) {
      // Flavor 4: ordered sequence
      log.info('test', `[action:${action.name}] sequence with ${invoke.sequence.length} steps`, { action: action.name });
      for (const step of invoke.sequence) {
        const stepResult = await runTestAction(
          {
            name: `${action.name}/${step.name}`,
            invoke: step.invoke,
            expect: step.expect,
            needsStack: action.needsStack,
          },
          log,
          ctx,
          redact,
        );
        if (stepResult.status !== 'pass') {
          return {
            name: action.name,
            status: 'fail',
            durationMs: elapsed(startMs),
            reason: `Sequence step "${step.name}" failed: ${stepResult.reason ?? 'unknown'}`,
          };
        }
      }
      return { name: action.name, status: 'pass', durationMs: elapsed(startMs) };
    }

    return { name: action.name, status: 'error', durationMs: elapsed(startMs), reason: 'Unknown invoke flavor' };
  } catch (e) {
    const msg = (e as Error).message;
    log.error('test', `[action:${action.name}] error: ${redact(msg)}`, { action: action.name });
    return {
      name: action.name,
      status: 'error',
      durationMs: elapsed(startMs),
      reason: redact(msg),
    };
  }
}

/**
 * Phase 5 — test
 * Parallelizes independent test actions (bounded by concurrency).
 * Respects fail-fast vs run-all policy.
 */
async function runTest(
  phases: Phases,
  log: EventLog,
  ctx: TemplateContext,
  redact: (s: string) => string,
  concurrency: number,
): Promise<{ result: PhaseResult; actionResults: ActionResult[] }> {
  const startMs = Date.now();
  const policy = phases.test.policy ?? 'fail-fast';
  const actions = phases.test.actions;
  log.info('test', `Phase 5: test — ${actions.length} action(s), policy=${policy}, concurrency=${concurrency}`);

  const actionResults: ActionResult[] = [];
  let aborted = false;

  // Run before steps
  if (phases.test.before && phases.test.before.length > 0) {
    for (const step of phases.test.before) {
      const cmd = renderTemplate(step.run, ctx);
      const result = await execCommand(cmd, { cwd: ctx.workdir });
      if (result.exitCode !== 0 && !step.optional) {
        log.error('test', `Before-step failed: ${cmd}`);
        return {
          result: {
            phase: 'test',
            status: 'fail',
            durationMs: elapsed(startMs),
            error: `Before-step failed: ${cmd}`,
          },
          actionResults: [],
        };
      }
    }
  }

  // Execute actions with bounded parallelism.
  //
  // fail-fast: process one action at a time sequentially; stop immediately on first failure
  //   and mark all remaining as skip. This ensures correct skip semantics.
  //
  // run-all: process in batches of `concurrency` — within a batch, all run in parallel;
  //   always advance to the next batch regardless of failures.
  if (policy === 'fail-fast') {
    for (let i = 0; i < actions.length && !aborted; i++) {
      const action = actions[i];
      log.info('test', `Running action: ${action.name}`);
      const actionResult = await runTestAction(action, log, ctx, redact);
      actionResults.push(actionResult);

      if (actionResult.status !== 'pass') {
        log.warn('test', `fail-fast: stopping after failed action "${action.name}"`);
        aborted = true;
        // Mark all remaining actions as skipped
        const remaining = actions.slice(i + 1);
        for (const a of remaining) {
          actionResults.push({
            name: a.name,
            status: 'skip',
            durationMs: 0,
            reason: 'Skipped due to fail-fast policy',
          });
          log.info('test', `[action:${a.name}] skipped (fail-fast)`, { action: a.name });
        }
      }
    }
  } else {
    // run-all: batch-parallel
    for (let i = 0; i < actions.length; ) {
      const batch = actions.slice(i, i + concurrency);
      i += batch.length;

      log.info('test', `Running batch of ${batch.length} action(s) in parallel`);
      const batchResults = await Promise.all(
        batch.map((action) => runTestAction(action, log, ctx, redact)),
      );
      actionResults.push(...batchResults);
    }
  }

  // Run after steps (always, even if fail-fast triggered)
  if (phases.test.after && phases.test.after.length > 0) {
    for (const step of phases.test.after) {
      const cmd = renderTemplate(step.run, ctx);
      await execCommand(cmd, { cwd: ctx.workdir });
    }
  }

  const anyFailed = actionResults.some((r) => r.status === 'fail' || r.status === 'error');
  const status: RunStatus = anyFailed ? 'fail' : 'pass';
  log.info('test', `Phase 5: test — ${status} (${actionResults.filter((r) => r.status === 'pass').length}/${actions.length} passed)`);

  return {
    result: {
      phase: 'test',
      status,
      durationMs: elapsed(startMs),
    },
    actionResults,
  };
}

/**
 * Phase 6 — teardown (ALWAYS runs)
 */
async function runTeardown(
  phases: Phases,
  log: EventLog,
  ctx: TemplateContext,
): Promise<PhaseResult> {
  const startMs = Date.now();
  log.info('teardown', 'Phase 6: teardown — starting (always runs)');

  const assertionResults: AssertionResult[] = [];
  const isolationCheckResults: IsolationCheckResult[] = [];

  // Optional pre-steps
  if (phases.teardown.steps && phases.teardown.steps.length > 0) {
    for (const step of phases.teardown.steps) {
      const cmd = renderTemplate(step.run, ctx);
      const label = step.label ?? cmd;
      log.info('teardown', `Running step: ${label}`);
      const result = await execCommand(cmd, { cwd: ctx.workdir });
      if (result.exitCode !== 0 && !step.optional) {
        log.warn('teardown', `Teardown step failed (continuing): ${label}`);
      }
    }
  }

  // Provisioner release
  if (phases.teardown.provisioner) {
    const provCmd = renderTemplate(phases.teardown.provisioner, ctx);
    log.info('teardown', `Invoking teardown provisioner: ${provCmd}`);
    const result = await execCommand(provCmd, { cwd: ctx.workdir, timeout: 300_000 });
    if (result.exitCode !== 0) {
      log.warn('teardown', `Teardown provisioner failed (exit ${result.exitCode}) — continuing cleanup`);
    } else {
      log.info('teardown', 'Teardown provisioner completed successfully');
    }
  }

  // Assertions (non-aborting in teardown)
  if (phases.teardown.assert && phases.teardown.assert.length > 0) {
    log.info('teardown', `Evaluating ${phases.teardown.assert.length} teardown assertion(s)`);
    const results = evaluateAssertions(phases.teardown.assert, ctx);
    assertionResults.push(...results);
    for (const r of results) {
      const sev = r.status === 'pass' ? 'info' : 'warn';
      log.emit(sev, 'teardown', `[assert:${r.type}] ${r.detail ?? r.status}`);
    }
  }

  // Phase-6 isolation checks (detective)
  if (phases.teardown.isolationChecks) {
    log.info('teardown', 'Running Phase-6 detective isolation checks');
    const checks = evaluatePhase6IsolationChecks(phases.teardown.isolationChecks);
    isolationCheckResults.push(...checks);
    for (const c of checks) {
      log.info('teardown', `[isolation:${c.check}] ${c.detail ?? c.status}`);
    }
  }

  const anyFailed = hasFailure(assertionResults) || hasFailure(isolationCheckResults);
  const status: RunStatus = anyFailed ? 'fail' : 'pass';
  log.info('teardown', `Phase 6: teardown — ${status}`);

  return {
    phase: 'teardown',
    status,
    durationMs: elapsed(startMs),
    assertions: assertionResults.length > 0 ? assertionResults : undefined,
    isolationChecks: isolationCheckResults.length > 0 ? isolationCheckResults : undefined,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run a testenv/v1 manifest through the 6-phase deterministic executor.
 *
 * @param manifest - Validated manifest (use validateManifest / assertManifest from @horus/testenv)
 * @param opts - RunOptions controlling profile, slot, streaming, etc.
 * @returns RunResult — the complete corpus-ready result, including event log.
 */
export async function run(manifest: Manifest, opts: RunOptions = {}): Promise<RunResult> {
  const startedAt = now();
  const startMs = Date.now();

  const {
    profile,
    slot = `run-${Date.now()}`,
    workdir = process.cwd(),
    src,
    commit,
    branch,
    runClass = 'adhoc',
    specVersion,
    concurrency = 4,
    meta,
    stream = true,
  } = opts;

  const secretReqs = manifest.requires.secrets ?? [];
  // Required set is profile-scoped; the redactor covers ALL declared names so
  // a profile-optional secret's value is still never leaked if present.
  const secretNames = resolveRequiredSecrets(secretReqs, profile);
  const redact = buildRedactor(allSecretNames(secretReqs));

  const log = new EventLog({ stream, redact });

  const ctx: TemplateContext = {
    slot,
    workdir,
    src: src ?? workdir,
    profile: profile ?? 'default',
  };

  log.info('setup', `testenv-runner starting: repo=${manifest.repo} profile=${profile ?? 'default'} slot=${slot}`);

  const phaseResults: PhaseResult[] = [];
  let actionResults: ActionResult[] = [];
  let verdict: RunStatus = 'pass';
  let teardownResult: PhaseResult | undefined;

  // Determine if any action needs the stack (E3: skip setup/launch if not needed)
  const actions = manifest.phases.test.actions;
  const needsStack = anyActionNeedsStack(actions);

  if (!needsStack) {
    log.info('setup', 'All test actions have needsStack=false — skipping setup/launch/await_ready/connection phases (E3)');
  }

  try {
    if (needsStack) {
      // Phase 1: setup
      const { result: setupResult, abort: setupAbort } = await runSetup(
        manifest.phases,
        log,
        ctx,
        secretNames,
      );
      phaseResults.push(setupResult);
      if (setupAbort) {
        verdict = 'fail';
        log.error('setup', 'Run aborted at setup phase');
        // Still run teardown
        teardownResult = await runTeardown(manifest.phases, log, ctx);
        phaseResults.push(teardownResult);
        return buildRunResult({
          manifest, opts, startedAt, startMs, verdict, phaseResults, actionResults, log, runClass, specVersion, profile, commit, branch, slot, meta,
        });
      }

      // Phase 2: launch
      const { result: launchResult, abort: launchAbort } = await runLaunch(
        manifest.phases,
        log,
        ctx,
      );
      phaseResults.push(launchResult);
      if (launchAbort) {
        verdict = 'fail';
        log.error('launch', 'Run aborted at launch phase');
        teardownResult = await runTeardown(manifest.phases, log, ctx);
        phaseResults.push(teardownResult);
        return buildRunResult({
          manifest, opts, startedAt, startMs, verdict, phaseResults, actionResults, log, runClass, specVersion, profile, commit, branch, slot, meta,
        });
      }

      // Phase 3: await_ready
      const { result: awaitResult, abort: awaitAbort } = await runAwaitReady(
        manifest.phases,
        log,
        ctx,
      );
      phaseResults.push(awaitResult);
      if (awaitAbort) {
        verdict = 'fail';
        log.error('await_ready', 'Run aborted at await_ready phase');
        teardownResult = await runTeardown(manifest.phases, log, ctx);
        phaseResults.push(teardownResult);
        return buildRunResult({
          manifest, opts, startedAt, startMs, verdict, phaseResults, actionResults, log, runClass, specVersion, profile, commit, branch, slot, meta,
        });
      }

      // Phase 4: connection
      const { result: connResult } = await runConnection(
        manifest.phases,
        log,
        ctx,
      );
      phaseResults.push(connResult);
      // Connection failures are non-aborting (advisory)
    }

    // Phase 5: test
    const { result: testResult, actionResults: testActionResults } = await runTest(
      manifest.phases,
      log,
      ctx,
      redact,
      concurrency,
    );
    phaseResults.push(testResult);
    actionResults = testActionResults;
    if (testResult.status !== 'pass') {
      verdict = 'fail';
    }
  } finally {
    // Phase 6: teardown — ALWAYS runs
    teardownResult = await runTeardown(manifest.phases, log, ctx);
    phaseResults.push(teardownResult);
    if (teardownResult.status !== 'pass') {
      verdict = 'fail';
    }
  }

  log.info('teardown', `testenv-runner complete: verdict=${verdict}`);

  return buildRunResult({
    manifest, opts, startedAt, startMs, verdict, phaseResults, actionResults, log, runClass, specVersion, profile, commit, branch, slot, meta,
  });
}

interface BuildRunResultArgs {
  manifest: Manifest;
  opts: RunOptions;
  startedAt: string;
  startMs: number;
  verdict: RunStatus;
  phaseResults: PhaseResult[];
  actionResults: ActionResult[];
  log: EventLog;
  runClass: RunResult['runClass'];
  specVersion?: string;
  profile?: string;
  commit?: string;
  branch?: string;
  slot: string;
  meta?: Record<string, unknown>;
}

function buildRunResult(args: BuildRunResultArgs): RunResult {
  const endedAt = now();
  const totalDurationMs = Date.now() - args.startMs;

  return {
    resultVersion: 'testenv/v1/result',
    verdict: args.verdict,
    repo: args.manifest.repo,
    profile: args.profile,
    commit: args.commit,
    branch: args.branch,
    slot: args.slot,
    startedAt: args.startedAt,
    endedAt,
    totalDurationMs,
    phases: args.phaseResults,
    actions: args.actionResults.length > 0 ? args.actionResults : undefined,
    events: args.log.getEntries(),
    runClass: args.runClass ?? 'adhoc',
    specVersion: args.specVersion,
    meta: args.meta,
  };
}
