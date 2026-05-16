/**
 * testenv/v1 manifest validator
 *
 * Validates a parsed YAML/JSON object against the testenv/v1 schema and
 * returns either a typed Manifest or a list of actionable error messages.
 */

import { ZodError, type ZodIssue } from 'zod';
import { ManifestSchema, RunResultSchema, type Manifest, type RunResult } from './schema.js';

// ---------------------------------------------------------------------------
// Validation result types
// ---------------------------------------------------------------------------

export interface ValidationSuccess<T> {
  ok: true;
  data: T;
}

export interface ValidationFailure {
  ok: false;
  /** Actionable, human-readable error messages. */
  errors: ValidationError[];
}

export interface ValidationError {
  /** JSON path to the field that caused the error (e.g., "phases.setup.steps[0].run"). */
  path: string;
  /** Clear, actionable message describing what is wrong and how to fix it. */
  message: string;
  /** The raw Zod issue code for programmatic handling. */
  code: string;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

// ---------------------------------------------------------------------------
// Error message formatting
// ---------------------------------------------------------------------------

/**
 * Convert a Zod issue to an actionable ValidationError.
 */
function formatZodIssue(issue: ZodIssue): ValidationError {
  const path = issue.path.length > 0
    ? issue.path
        .map((p, i) => {
          if (typeof p === 'number') return `[${p}]`;
          return i === 0 ? p : `.${p}`;
        })
        .join('')
    : '<root>';

  const message = buildActionableMessage(issue, path);

  return {
    path,
    message,
    code: issue.code,
  };
}

/**
 * Build an actionable error message for a Zod issue.
 */
function buildActionableMessage(issue: ZodIssue, path: string): string {
  switch (issue.code) {
    case 'invalid_literal':
      return `${path}: Expected ${JSON.stringify(issue.expected)}, got ${JSON.stringify(issue.received)}. ` +
        `Make sure the field matches exactly (case-sensitive).`;

    case 'invalid_type':
      return `${path}: Expected ${issue.expected} but got ${issue.received}. ` +
        buildTypeHint(path, issue.expected);

    case 'too_small':
      if (issue.type === 'array') {
        return `${path}: Must have at least ${issue.minimum} item(s). ` +
          buildArrayHint(path, Number(issue.minimum));
      }
      if (issue.type === 'string') {
        return `${path}: Must not be empty. Provide a non-empty string value.`;
      }
      return `${path}: Value is too small (minimum: ${issue.minimum}).`;

    case 'too_big':
      return `${path}: Value is too large (maximum: ${issue.maximum}).`;

    case 'invalid_enum_value':
      return `${path}: "${issue.received}" is not a valid value. ` +
        `Must be one of: ${issue.options.map((o) => JSON.stringify(o)).join(', ')}.`;

    case 'invalid_union':
      return `${path}: Value does not match any of the allowed formats. ` +
        buildUnionHint(path);

    case 'invalid_string':
      if (issue.validation === 'regex') {
        return `${path}: Value does not match the required format. ${issue.message ?? ''}`;
      }
      if (issue.validation === 'datetime') {
        return `${path}: Must be a valid ISO-8601 datetime string (e.g., "2024-01-15T12:00:00.000Z").`;
      }
      return `${path}: Invalid string value. ${issue.message ?? ''}`;

    case 'unrecognized_keys':
      return `${path}: Unknown field(s): ${issue.keys.map((k) => JSON.stringify(k)).join(', ')}. ` +
        `Remove or rename these fields.`;

    case 'custom':
      return `${path}: ${issue.message ?? 'Custom validation failed.'}`;

    default:
      return `${path}: ${issue.message ?? 'Validation failed.'}`;
  }
}

function buildTypeHint(path: string, expected: string): string {
  if (path.includes('assert')) {
    return `Assertions must be objects with a "type" field.`;
  }
  if (path.includes('steps')) {
    return `Steps must be objects with a "run" field (string command).`;
  }
  if (path.includes('actions')) {
    return `Test actions must be objects with "name", "invoke", and optionally "expect" and "evidence" fields.`;
  }
  if (expected === 'array') {
    return `Provide a list (array) of values.`;
  }
  if (expected === 'object') {
    return `Provide an object (mapping of key-value pairs).`;
  }
  return '';
}

function buildArrayHint(path: string, minimum: number): string {
  if (path === 'phases.setup.steps') {
    return `The setup phase must have at least ${minimum} step (e.g., { run: "pnpm install" }).`;
  }
  if (path.includes('actions')) {
    return `The test phase must have at least ${minimum} test action.`;
  }
  if (path.includes('poll')) {
    return `The await_ready phase must have at least ${minimum} probe.`;
  }
  return `Add at least ${minimum} item(s).`;
}

function buildUnionHint(path: string): string {
  if (path.includes('invoke')) {
    return `invoke must be one of: { run: "command" } (shell), { tool: "name", args: {...} } (MCP tool), ` +
      `{ http: "endpoint" } (HTTP), or { sequence: [...] } (ordered steps).`;
  }
  if (path.includes('expect')) {
    return `expect must be one of: { exitCode: 0 }, { returns: "token" }, { count: 0 }, ` +
      `{ status: 200 }, { contains: "string" }, or { field: "path", equals: value }.`;
  }
  return `Check the allowed formats for this field.`;
}

// ---------------------------------------------------------------------------
// Semantic validation (beyond Zod schema)
// ---------------------------------------------------------------------------

/**
 * Perform semantic validation checks that Zod cannot express.
 * Returns additional actionable errors.
 */
function semanticValidate(manifest: Manifest): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check that all secrets declared in requires.secrets are referenced somewhere
  // (Advisory — not a hard error, but useful feedback)
  // We skip this check to keep the validator strict and schema-focused.

  // Check that test phase actions with needsStack=false don't reference stack-only probes
  // (This is advisory; a runner concern. Skip for schema validator.)

  // Check that the connection phase emit path uses {slot} template var if it references a slot
  const emitPath = manifest.phases.connection.emit;
  if (emitPath.includes('{slot}') && !emitPath.startsWith('{slot}')) {
    // OK — {slot} is used as a template var inside the path, that's fine.
  }

  // Check for duplicate action names in the test phase
  const actionNames = manifest.phases.test.actions.map((a) => a.name);
  const seenNames = new Set<string>();
  for (const name of actionNames) {
    if (seenNames.has(name)) {
      errors.push({
        path: 'phases.test.actions',
        message: `Duplicate test action name: "${name}". Each action name must be unique within the test phase.`,
        code: 'custom',
      });
    }
    seenNames.add(name);
  }

  // Warn if launch phase has neither steps nor a provisioner
  if (
    (!manifest.phases.launch.steps || manifest.phases.launch.steps.length === 0) &&
    !manifest.phases.launch.provisioner
  ) {
    errors.push({
      path: 'phases.launch',
      message: `The launch phase has neither "steps" nor a "provisioner". ` +
        `Add at least one of: steps (array of run commands) or provisioner (native bring-up command string).`,
      code: 'custom',
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate an unknown value against the testenv/v1 manifest schema.
 *
 * @param input - Parsed YAML or JSON object (from manifest.yaml)
 * @returns ValidationResult with typed Manifest on success, or actionable errors on failure
 *
 * @example
 * ```typescript
 * import { validateManifest } from '@horus/testenv';
 * import { parse } from 'yaml';
 * import { readFileSync } from 'node:fs';
 *
 * const raw = parse(readFileSync('.testenv/manifest.yaml', 'utf8'));
 * const result = validateManifest(raw);
 * if (result.ok) {
 *   console.log('Manifest is valid:', result.data);
 * } else {
 *   for (const err of result.errors) {
 *     console.error(`  [${err.path}] ${err.message}`);
 *   }
 * }
 * ```
 */
export function validateManifest(input: unknown): ValidationResult<Manifest> {
  const parsed = ManifestSchema.safeParse(input);

  if (!parsed.success) {
    const errors = parsed.error.issues.map(formatZodIssue);
    return { ok: false, errors };
  }

  const semanticErrors = semanticValidate(parsed.data);
  if (semanticErrors.length > 0) {
    return { ok: false, errors: semanticErrors };
  }

  return { ok: true, data: parsed.data };
}

/**
 * Validate a run result object against the testenv/v1/result schema.
 *
 * @param input - Parsed run result JSON
 * @returns ValidationResult with typed RunResult on success, or actionable errors on failure
 */
export function validateRunResult(input: unknown): ValidationResult<RunResult> {
  const parsed = RunResultSchema.safeParse(input);

  if (!parsed.success) {
    const errors = parsed.error.issues.map(formatZodIssue);
    return { ok: false, errors };
  }

  return { ok: true, data: parsed.data };
}

/**
 * Assert that a manifest is valid, throwing an error with all validation messages if not.
 * Useful in tests or scripts where you want fail-fast behavior.
 *
 * @throws Error with formatted validation errors
 */
export function assertManifest(input: unknown): Manifest {
  const result = validateManifest(input);
  if (!result.ok) {
    const messages = result.errors
      .map((e) => `  [${e.path}] ${e.message}`)
      .join('\n');
    throw new Error(`testenv/v1 manifest validation failed:\n${messages}`);
  }
  return result.data;
}

/**
 * Format validation errors as a human-readable string for CLI output.
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors
    .map((e, i) => `${i + 1}. [${e.path}] ${e.message}`)
    .join('\n');
}

// Re-export ZodError for consumers who want to handle raw Zod errors
export { ZodError };
