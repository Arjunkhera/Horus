/**
 * @horus/testenv
 *
 * testenv/v1 declarative manifest schema, types, and validator.
 *
 * Repo-agnostic: no Horus-specific assumptions.
 * The schema and validator are designed to be consumed by:
 * - The runner core CLI (phase executor, assertion engine)
 * - The sdlc-testenv executor subagent
 * - Any future CI regression gate (corpus-ready event log format)
 */

// Schema (Zod)
export {
  // Assertion types
  AssertionSchema,
  // Isolation invariant check schemas
  Phase1IsolationChecksSchema,
  Phase2IsolationChecksSchema,
  Phase6IsolationChecksSchema,
  // Step / probe
  StepSchema,
  ProbeSchema,
  // Invoke / expect / evidence
  InvokeSchema,
  ExpectSchema,
  EvidenceSchema,
  // Test action
  TestActionSchema,
  // Phase schemas
  SetupPhaseSchema,
  LaunchPhaseSchema,
  AwaitReadyPhaseSchema,
  ConnectionPhaseSchema,
  TestPhaseSchema,
  TeardownPhaseSchema,
  // Requires / profile
  RequiresSchema,
  SecretRequirementSchema,
  ProfileSchema,
  PhasesSchema,
  // Secret resolution helpers
  allSecretNames,
  resolveRequiredSecrets,
  // Root manifest
  ManifestSchema,
  // Event log / result
  EventSeveritySchema,
  PhaseIdSchema,
  RunStatusSchema,
  EventLogEntrySchema,
  PhaseResultSchema,
  ActionResultSchema,
  RunResultSchema,
} from './schema.js';

// TypeScript types (inferred from Zod schemas)
export type {
  Assertion,
  Phase1IsolationChecks,
  Phase2IsolationChecks,
  Phase6IsolationChecks,
  Step,
  Probe,
  Invoke,
  Expect,
  Evidence,
  TestAction,
  SetupPhase,
  LaunchPhase,
  AwaitReadyPhase,
  ConnectionPhase,
  TestPhase,
  TeardownPhase,
  Requires,
  SecretRequirement,
  Profile,
  Phases,
  Manifest,
  EventSeverity,
  PhaseId,
  RunStatus,
  EventLogEntry,
  PhaseResult,
  ActionResult,
  RunResult,
} from './schema.js';

// Validator
export {
  validateManifest,
  validateRunResult,
  assertManifest,
  formatValidationErrors,
  ZodError,
} from './validator.js';

export type {
  ValidationSuccess,
  ValidationFailure,
  ValidationError,
  ValidationResult,
} from './validator.js';
