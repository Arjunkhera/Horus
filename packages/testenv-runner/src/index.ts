/**
 * @horus/testenv-runner
 *
 * runner-core — deterministic 6-phase executor for testenv/v1 manifests.
 *
 * Public API:
 * - `run(manifest, opts)` — execute a validated manifest, return RunResult
 * - `loadManifest(path)` — load and validate a manifest.yaml from disk
 * - `RunOptions` — options type for `run()`
 */

export { run } from './runner.js';
export type { RunOptions } from './runner.js';
export { loadManifest } from './loader.js';
export { buildRedactor, redactValue } from './redact.js';
export { renderTemplate } from './template.js';
export type { TemplateContext } from './template.js';
export { EventLog } from './event-log.js';
export type { EventLogOptions } from './event-log.js';
export {
  evaluateAssertions,
  evaluatePhase1IsolationChecks,
  evaluatePhase2IsolationChecks,
  evaluatePhase6IsolationChecks,
  hasFailure,
} from './assertions.js';
export type { AssertionResult, IsolationCheckResult } from './assertions.js';
