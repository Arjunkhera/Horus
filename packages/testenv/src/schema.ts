/**
 * testenv/v1 — declarative manifest schema (Zod)
 *
 * Repo-agnostic: no assumptions about the specific stack under test.
 * All Horus-specific values (provisioner commands, service names, etc.)
 * are expressed as data in the per-repo manifest, not hardcoded here.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * A shell command string (may include template variables like {slot}).
 */
const CommandString = z.string().min(1);

/**
 * Non-empty identifier string (used for names, labels, etc.).
 */
const Identifier = z.string().min(1).regex(/^[\w][\w\s._-]*$/, {
  message: 'Must start with a word character and contain only word chars, spaces, dots, dashes, or underscores',
});

// ---------------------------------------------------------------------------
// Assertion definitions (machine-checkable end-state assertions)
// ---------------------------------------------------------------------------

/**
 * path_exists — assert that a file or directory exists at the given path.
 * Supports template variables: {slot}, {workdir}, etc.
 */
const PathExistsAssertion = z.object({
  type: z.literal('path_exists'),
  path: z.string().min(1).describe('Filesystem path to assert exists (template vars allowed)'),
});

/**
 * cmd_exit_zero — assert that the given command exits with code 0.
 */
const CmdExitZeroAssertion = z.object({
  type: z.literal('cmd_exit_zero'),
  run: CommandString.describe('Command to execute; must exit 0'),
});

/**
 * containers_running — assert that exactly N containers in the docker project are running.
 */
const ContainersRunningAssertion = z.object({
  type: z.literal('containers_running'),
  count: z.number().int().nonnegative(),
});

/**
 * containers_remaining — assert that exactly N containers in the docker project remain
 * (used in teardown to confirm full cleanup).
 */
const ContainersRemainingAssertion = z.object({
  type: z.literal('containers_remaining'),
  count: z.number().int().nonnegative(),
});

/**
 * ports_disjoint_from_live — assert that no declared port conflicts with the live stack.
 */
const PortsDisjointAssertion = z.object({
  type: z.literal('ports_disjoint_from_live'),
  value: z.literal(true),
});

/**
 * docker_project_name — assert the docker project name matches the given pattern.
 * Template vars: {slot}.
 */
const DockerProjectNameAssertion = z.object({
  type: z.literal('docker_project_name'),
  pattern: z.string().min(1).describe('Expected docker project name (template vars allowed)'),
});

/**
 * file_parses — assert that the file at path is valid JSON/YAML.
 */
const FileParsesAssertion = z.object({
  type: z.literal('file_parses'),
  path: z.string().min(1).describe('File path to parse-check (template vars allowed)'),
  format: z.enum(['json', 'yaml']).default('json'),
});

/**
 * env_vars_present — assert that all listed environment variable names are set (non-empty).
 * Values are never logged or exposed.
 */
const EnvVarsPresentAssertion = z.object({
  type: z.literal('env_vars_present'),
  names: z.array(z.string().min(1)).min(1),
});

/**
 * live_stack_unmodified — assert that the live docker stack is still running with no
 * containers stopped or containers added. Checked post-teardown.
 */
const LiveStackUnmodifiedAssertion = z.object({
  type: z.literal('live_stack_unmodified'),
  value: z.literal(true),
});

/**
 * live_data_test_artifacts_zero — assert that the live stack data contains zero
 * test artifacts (e.g., entities, notes, or files created during the test run).
 */
const LiveDataTestArtifactsZeroAssertion = z.object({
  type: z.literal('live_data_test_artifacts_zero'),
  value: z.literal(true),
});

/**
 * no_secret_residue — assert that no secret values appear in any container logs,
 * temp files, or config files left after teardown.
 */
const NoSecretResidueAssertion = z.object({
  type: z.literal('no_secret_residue'),
  value: z.literal(true),
});

/**
 * mcp_names_suffixed — assert that all MCP server names in the connection manifest
 * carry the given suffix (e.g., "-dev").
 */
const McpNamesSuffixedAssertion = z.object({
  type: z.literal('mcp_names_suffixed'),
  suffix: z.string().min(1),
});

/**
 * fully_projected_ports — assert that all service ports are explicitly mapped
 * (no port-range wildcards or overlay-merge).
 */
const FullyProjectedPortsAssertion = z.object({
  type: z.literal('fully_projected_ports'),
  value: z.literal(true),
});

/**
 * http_ok — assert that an HTTP GET to the given URL returns a 2xx status.
 */
const HttpOkAssertion = z.object({
  type: z.literal('http_ok'),
  url: z.string().min(1).describe('URL to GET (template vars allowed)'),
});

/**
 * Union of all supported assertion types.
 */
export const AssertionSchema = z.discriminatedUnion('type', [
  PathExistsAssertion,
  CmdExitZeroAssertion,
  ContainersRunningAssertion,
  ContainersRemainingAssertion,
  PortsDisjointAssertion,
  DockerProjectNameAssertion,
  FileParsesAssertion,
  EnvVarsPresentAssertion,
  LiveStackUnmodifiedAssertion,
  LiveDataTestArtifactsZeroAssertion,
  NoSecretResidueAssertion,
  McpNamesSuffixedAssertion,
  FullyProjectedPortsAssertion,
  HttpOkAssertion,
]);

export type Assertion = z.infer<typeof AssertionSchema>;

// ---------------------------------------------------------------------------
// Isolation invariant check definitions
// ---------------------------------------------------------------------------

/**
 * Phase-1 (preventive) isolation checks.
 * Abort before touching anything shared if any check fails.
 */
export const Phase1IsolationChecksSchema = z.object({
  /** Docker project name must be disjoint from the live stack. */
  disjointDockerProject: z.boolean().default(true),
  /** Docker network names must be disjoint from the live stack. */
  disjointDockerNetworks: z.boolean().default(true),
  /** Docker volume names must be disjoint from the live stack. */
  disjointDockerVolumes: z.boolean().default(true),
  /** Host port space must be disjoint from the live stack's mapped ports. */
  disjointPortSpace: z.boolean().default(true),
  /** Data directory must be a distinct path not shared with the live stack. */
  disjointDataDir: z.boolean().default(true),
  /** All secrets declared in requires.secrets must be present in the environment. */
  allRequiredSecretsPresent: z.boolean().default(true),
});

export type Phase1IsolationChecks = z.infer<typeof Phase1IsolationChecksSchema>;

/**
 * Phase-2 (structural) isolation checks.
 * Verified after launch; abort if any check fails.
 */
export const Phase2IsolationChecksSchema = z.object({
  /** The docker project name is distinct from the live stack's project. */
  distinctDockerProject: z.boolean().default(true),
  /** All service ports are fully projected (no overlay-merge, no wildcards). */
  fullyProjectedPorts: z.boolean().default(true),
  /** A connection manifest has been emitted with correctly suffixed MCP server names. */
  connectionManifestEmitted: z.boolean().default(true),
});

export type Phase2IsolationChecks = z.infer<typeof Phase2IsolationChecksSchema>;

/**
 * Phase-6 (detective) isolation checks.
 * Run post-teardown to confirm nothing leaked.
 */
export const Phase6IsolationChecksSchema = z.object({
  /** The live stack is still running and unmodified. */
  liveStackUnmodified: z.boolean().default(true),
  /** The live stack's data contains zero test artifacts. */
  liveDataTestArtifactsZero: z.boolean().default(true),
  /** No secret values appear in logs, temp files, or configs left after teardown. */
  noSecretResidue: z.boolean().default(true),
});

export type Phase6IsolationChecks = z.infer<typeof Phase6IsolationChecksSchema>;

// ---------------------------------------------------------------------------
// Phase step
// ---------------------------------------------------------------------------

export const StepSchema = z.object({
  /** Shell command to execute. Template vars: {slot}, {workdir}, {src}. */
  run: CommandString,
  /** Optional human-readable label for log output. */
  label: z.string().optional(),
  /** If true, failure of this step is non-fatal (logged, but execution continues). */
  optional: z.boolean().default(false),
});

export type Step = z.infer<typeof StepSchema>;

// ---------------------------------------------------------------------------
// Probe (used in await_ready polling)
// ---------------------------------------------------------------------------

export const ProbeSchema = z.object({
  /** The probe to execute. Can be a tool name or an HTTP endpoint reference. */
  probe: z.string().min(1).describe('Tool name or "METHOD :port/path" for HTTP probes'),
  /** The expected result indicating readiness. */
  expect: z.string().min(1).describe('Expected result token (e.g., "returns_type_registry", "http_200")'),
  /** Optional args to pass to the probe (for tool probes). */
  args: z.record(z.unknown()).optional(),
});

export type Probe = z.infer<typeof ProbeSchema>;

// ---------------------------------------------------------------------------
// Test action — the do/check/proof unit
// ---------------------------------------------------------------------------

/**
 * Flavor 1: command + exit code check.
 */
const CommandInvokeSchema = z.object({
  /** Shell command to run. */
  run: CommandString,
});

/**
 * Flavor 2: tool/endpoint call + response assertion.
 */
const ToolInvokeSchema = z.object({
  /** Tool name to call. */
  tool: z.string().min(1),
  /** Arguments to pass to the tool. */
  args: z.record(z.unknown()).optional(),
});

const HttpInvokeSchema = z.object({
  /** HTTP endpoint reference (e.g., "live-anvil/search?q=check" or "GET :8080/health"). */
  http: z.string().min(1),
  /** Optional request body. */
  body: z.unknown().optional(),
});

export const InvokeSchema = z.union([CommandInvokeSchema, ToolInvokeSchema, HttpInvokeSchema]);
export type Invoke = z.infer<typeof InvokeSchema>;

/**
 * Expect clause for test actions.
 */
export const ExpectSchema = z.union([
  /** Exit code expectation (for command invocations). */
  z.object({ exitCode: z.number().int().default(0) }),
  /** Response field expectation (for tool/HTTP invocations). */
  z.object({ returns: z.string().min(1) }),
  /** Numeric count expectation (e.g., "count: 0" for isolation proof). */
  z.object({ count: z.number().int().nonnegative() }),
  /** HTTP status expectation. */
  z.object({ status: z.number().int().min(100).max(599) }),
  /** Raw string contains expectation. */
  z.object({ contains: z.string().min(1) }),
  /** Structured field equality expectation. */
  z.object({ field: z.string().min(1), equals: z.unknown() }),
]);

export type Expect = z.infer<typeof ExpectSchema>;

/**
 * Evidence clause — where/how to capture proof for this action.
 */
export const EvidenceSchema = z.object({
  /** Capture the raw response/output as evidence. */
  capture: z.enum(['response', 'stdout', 'stderr', 'both']).default('response'),
  /** Optional path within the response to extract (dot-notation). */
  extract: z.string().optional(),
  /** Where to store the evidence artifact (relative to slot dir). */
  saveTo: z.string().optional(),
});

export type Evidence = z.infer<typeof EvidenceSchema>;

/**
 * Flavor 3: short ordered sequence of sub-steps.
 */
const SequenceStepSchema = z.object({
  name: z.string().min(1),
  invoke: InvokeSchema,
  expect: ExpectSchema,
});

const SequenceInvokeSchema = z.object({
  sequence: z.array(SequenceStepSchema).min(2),
});

/**
 * A single test action: the do/check/proof triple.
 */
export const TestActionSchema = z.object({
  /** Human-readable name for the action (used in logs and reports). */
  name: Identifier,
  /**
   * What to invoke. Three flavors:
   * 1. `{ run: "command" }` — shell command
   * 2. `{ tool: "tool_name", args: {...} }` — MCP tool call
   * 3. `{ http: "endpoint" }` — HTTP request
   * 4. `{ sequence: [...] }` — ordered sub-steps
   */
  invoke: z.union([CommandInvokeSchema, ToolInvokeSchema, HttpInvokeSchema, SequenceInvokeSchema]),
  /** Machine-checkable assertion on the result. */
  expect: ExpectSchema.optional(),
  /** How to capture and store evidence (proof). */
  evidence: EvidenceSchema.optional(),
  /**
   * Whether this action requires the full stack to be running.
   * If false, the runner may skip setup/launch/await_ready/teardown phases
   * and run only this action in-process (fast unit/type inner loop).
   */
  needsStack: z.boolean().default(true),
  /** Optional tags for filtering / grouping. */
  tags: z.array(z.string()).optional(),
});

export type TestAction = z.infer<typeof TestActionSchema>;

// ---------------------------------------------------------------------------
// Phase definitions
// ---------------------------------------------------------------------------

/**
 * Phase 1 — setup: clone code, build, prepare file layout.
 */
export const SetupPhaseSchema = z.object({
  steps: z.array(StepSchema).min(1),
  assert: z.array(AssertionSchema).optional(),
  /**
   * Phase-1 isolation checks (preventive).
   * Abort before touching anything shared if any enabled check fails.
   */
  isolationChecks: Phase1IsolationChecksSchema.optional(),
});

export type SetupPhase = z.infer<typeof SetupPhaseSchema>;

/**
 * Phase 2 — launch: bring up the stack.
 * A `provisioner` command is the recommended bring-up mechanism.
 */
export const LaunchPhaseSchema = z.object({
  /** Steps to run before the provisioner (e.g., environment prep). */
  steps: z.array(StepSchema).optional(),
  /**
   * Native bring-up command for this repo's stack.
   * The runner shells out to this command to start the isolated environment.
   * Template vars: {slot}, {profile}.
   * Example: "horus test-env acquire --slot {slot} --standalone"
   */
  provisioner: CommandString.optional(),
  assert: z.array(AssertionSchema).optional(),
  /**
   * Phase-2 isolation checks (structural).
   * Verified after launch; abort if any check fails.
   */
  isolationChecks: Phase2IsolationChecksSchema.optional(),
});

export type LaunchPhase = z.infer<typeof LaunchPhaseSchema>;

/**
 * Phase 3 — await_ready: poll until all services are ready.
 */
export const AwaitReadyPhaseSchema = z.object({
  poll: z.array(ProbeSchema).min(1),
  /** Timeout in seconds. Default: 180. */
  timeout: z.number().int().positive().default(180),
  /** Interval between polls in seconds. Default: 5. */
  interval: z.number().int().positive().default(5),
  assert: z.array(AssertionSchema).optional(),
});

export type AwaitReadyPhase = z.infer<typeof AwaitReadyPhaseSchema>;

/**
 * Phase 4 — connection: emit the connection manifest (e.g., MCP settings).
 */
export const ConnectionPhaseSchema = z.object({
  steps: z.array(StepSchema).optional(),
  /**
   * Path to emit the connection manifest to.
   * Template vars: {slot}.
   * Example: "{slot}/claude-settings.json"
   */
  emit: z.string().min(1),
  assert: z.array(AssertionSchema).optional(),
});

export type ConnectionPhase = z.infer<typeof ConnectionPhaseSchema>;

/**
 * Phase 5 — test: execute the test actions.
 */
export const TestPhaseSchema = z.object({
  /** Execution policy when a test action fails. */
  policy: z.enum(['fail-fast', 'run-all']).default('fail-fast'),
  actions: z.array(TestActionSchema).min(1),
  /** Setup steps to run before any test actions. */
  before: z.array(StepSchema).optional(),
  /** Teardown steps to run after all test actions (regardless of pass/fail). */
  after: z.array(StepSchema).optional(),
});

export type TestPhase = z.infer<typeof TestPhaseSchema>;

/**
 * Phase 6 — teardown: release the stack and verify isolation invariants.
 */
export const TeardownPhaseSchema = z.object({
  /** Steps to run before the provisioner release command. */
  steps: z.array(StepSchema).optional(),
  /**
   * Native release command for this repo's stack.
   * Template vars: {slot}.
   * Example: "horus test-env release --slot {slot}"
   */
  provisioner: CommandString.optional(),
  assert: z.array(AssertionSchema).optional(),
  /**
   * Phase-6 isolation checks (detective).
   * Run post-teardown to confirm nothing leaked.
   */
  isolationChecks: Phase6IsolationChecksSchema.optional(),
});

export type TeardownPhase = z.infer<typeof TeardownPhaseSchema>;

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export const ProfileSchema = z.object({
  /** Memory budget (Docker-style: "6g", "12g", "512m"). */
  mem: z.string().regex(/^\d+[gGmMkK]$/, {
    message: 'mem must be a Docker-style memory string e.g. "6g", "512m"',
  }),
  /** Optional CPU limit (number of cores or millicores like "2.0"). */
  cpu: z.string().optional(),
  /** Arbitrary additional profile-specific config. */
  extra: z.record(z.unknown()).optional(),
});

export type Profile = z.infer<typeof ProfileSchema>;

// ---------------------------------------------------------------------------
// Requires
// ---------------------------------------------------------------------------

/**
 * A required secret. Either a bare env-var name (always required), or an
 * object that scopes the requirement to specific run profiles. A profile-scoped
 * secret is only asserted present when the active --profile is in `profiles`;
 * outside those profiles it is optional (the service that needs it is not
 * under test).
 */
export const SecretRequirementSchema = z.union([
  z.string().min(1),
  z.object({
    name: z.string().min(1),
    profiles: z.array(z.string().min(1)).nonempty(),
  }),
]);

export type SecretRequirement = z.infer<typeof SecretRequirementSchema>;

/**
 * Every declared secret name regardless of profile scoping.
 * Used to build the redactor so values are never leaked, even when the
 * secret is optional for the active profile.
 */
export function allSecretNames(secrets: SecretRequirement[]): string[] {
  return secrets.map((s) => (typeof s === 'string' ? s : s.name));
}

/**
 * The secret names that MUST be present for the given run profile.
 * Bare-string secrets are always required. Object secrets are required only
 * when the active profile is listed in their `profiles`.
 */
export function resolveRequiredSecrets(
  secrets: SecretRequirement[],
  profileName: string | undefined,
): string[] {
  return secrets
    .filter((s) =>
      typeof s === 'string'
        ? true
        : profileName !== undefined && s.profiles.includes(profileName),
    )
    .map((s) => (typeof s === 'string' ? s : s.name));
}

export const RequiresSchema = z.object({
  /**
   * Environment variables required by this manifest. Each entry is either a
   * bare NAME (always required) or `{ name, profiles }` (required only under
   * the listed run profiles). The runner asserts the resolved set is present
   * (non-empty) at Phase 1. Values are never logged or exposed.
   */
  secrets: z.array(SecretRequirementSchema).default([]),
  /**
   * Named run profiles (e.g., laptop, cloud) with resource budgets.
   * At least one profile is recommended.
   */
  profiles: z.record(ProfileSchema).optional(),
});

export type Requires = z.infer<typeof RequiresSchema>;

// ---------------------------------------------------------------------------
// Phases map
// ---------------------------------------------------------------------------

export const PhasesSchema = z.object({
  setup: SetupPhaseSchema,
  launch: LaunchPhaseSchema,
  await_ready: AwaitReadyPhaseSchema,
  connection: ConnectionPhaseSchema,
  test: TestPhaseSchema,
  teardown: TeardownPhaseSchema,
});

export type Phases = z.infer<typeof PhasesSchema>;

// ---------------------------------------------------------------------------
// Root manifest
// ---------------------------------------------------------------------------

export const ManifestSchema = z.object({
  /**
   * Schema version. Must be "testenv/v1".
   */
  apiVersion: z.literal('testenv/v1'),
  /**
   * Human-readable identifier for the repo/project this manifest belongs to.
   * Used only for labeling in logs and reports — does not affect execution.
   */
  repo: z.string().min(1),
  requires: RequiresSchema,
  phases: PhasesSchema,
  /**
   * Manifest-level metadata. Arbitrary key/value pairs for tooling integration.
   */
  meta: z.record(z.unknown()).optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;

// ---------------------------------------------------------------------------
// Runner result / event-log format (corpus-ready)
// ---------------------------------------------------------------------------

/**
 * Severity levels for event log entries.
 */
export const EventSeveritySchema = z.enum(['debug', 'info', 'warn', 'error']);
export type EventSeverity = z.infer<typeof EventSeveritySchema>;

/**
 * Phase identifiers.
 */
export const PhaseIdSchema = z.enum([
  'setup',
  'launch',
  'await_ready',
  'connection',
  'test',
  'teardown',
]);
export type PhaseId = z.infer<typeof PhaseIdSchema>;

/**
 * Status of a phase or action.
 */
export const RunStatusSchema = z.enum(['pass', 'fail', 'skip', 'error']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

/**
 * A single event in the event log.
 * Designed corpus-ready: consumed unchanged by the future CI regression gate.
 */
export const EventLogEntrySchema = z.object({
  /** ISO-8601 timestamp. */
  ts: z.string().datetime(),
  /** Log severity. */
  severity: EventSeveritySchema,
  /** Phase this event belongs to. */
  phase: PhaseIdSchema,
  /** Optional action name (for test phase events). */
  action: z.string().optional(),
  /** Human-readable message. */
  message: z.string(),
  /** Structured payload (optional). Secrets must be redacted before inclusion. */
  payload: z.record(z.unknown()).optional(),
});

export type EventLogEntry = z.infer<typeof EventLogEntrySchema>;

/**
 * Per-phase result summary.
 */
export const PhaseResultSchema = z.object({
  phase: PhaseIdSchema,
  status: RunStatusSchema,
  /** Duration in milliseconds. */
  durationMs: z.number().nonnegative(),
  /** Assertion results for this phase. */
  assertions: z.array(z.object({
    type: z.string(),
    status: RunStatusSchema,
    detail: z.string().optional(),
  })).optional(),
  /** Isolation check results (phases 1, 2, 6). */
  isolationChecks: z.array(z.object({
    check: z.string(),
    status: RunStatusSchema,
    detail: z.string().optional(),
  })).optional(),
  /** Error message if phase failed. */
  error: z.string().optional(),
});

export type PhaseResult = z.infer<typeof PhaseResultSchema>;

/**
 * Per-action result summary (for test phase).
 */
export const ActionResultSchema = z.object({
  name: z.string(),
  status: RunStatusSchema,
  /** Duration in milliseconds. */
  durationMs: z.number().nonnegative(),
  /** Expected value (stringified). */
  expected: z.string().optional(),
  /** Actual value (stringified, secrets redacted). */
  actual: z.string().optional(),
  /** Reason for failure/skip. */
  reason: z.string().optional(),
  /** Reference to the evidence artifact (path or URL). */
  evidenceRef: z.string().optional(),
});

export type ActionResult = z.infer<typeof ActionResultSchema>;

/**
 * The complete runner result / event log.
 * This is the machine-readable output emitted by the runner core at the end of a run.
 * Corpus-ready: a future CI regression gate consumes this format unchanged.
 */
export const RunResultSchema = z.object({
  /** Schema version for the result format. */
  resultVersion: z.literal('testenv/v1/result'),
  /** Overall run verdict. */
  verdict: RunStatusSchema,
  /** The repo identifier from the manifest. */
  repo: z.string(),
  /** The profile used for this run (e.g., "laptop", "cloud"). */
  profile: z.string().optional(),
  /** Git commit hash of the code under test. */
  commit: z.string().optional(),
  /** Git branch of the code under test. */
  branch: z.string().optional(),
  /** The slot identifier for this run (used to namespace docker resources). */
  slot: z.string().optional(),
  /** ISO-8601 timestamp when the run started. */
  startedAt: z.string().datetime(),
  /** ISO-8601 timestamp when the run ended. */
  endedAt: z.string().datetime(),
  /** Total duration in milliseconds. */
  totalDurationMs: z.number().nonnegative(),
  /** Per-phase results (in phase order). */
  phases: z.array(PhaseResultSchema),
  /** Per-action results from the test phase. */
  actions: z.array(ActionResultSchema).optional(),
  /** Full event log (all phases). */
  events: z.array(EventLogEntrySchema),
  /**
   * Run classification: used by the corpus/CI gate.
   * "red" = pre-implementation test run (expected failures).
   * "green" = post-implementation test run (expected passes).
   * "regression" = CI regression run against committed test suite.
   * "adhoc" = manual/exploratory run outside the TDD cycle.
   */
  runClass: z.enum(['red', 'green', 'regression', 'adhoc']).default('adhoc'),
  /** The spec version (commit hash of the .testenv directory) this run targeted. */
  specVersion: z.string().optional(),
  /** Arbitrary metadata (story ID, PR number, CI job ID, etc.). */
  meta: z.record(z.unknown()).optional(),
});

export type RunResult = z.infer<typeof RunResultSchema>;
