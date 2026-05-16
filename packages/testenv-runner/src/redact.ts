/**
 * Secret redaction utilities.
 *
 * Enforces Gap #4: all output must be redacted of secret values.
 * Secrets are identified by their environment variable NAMES (never stored as values).
 * At redaction time we resolve the current value from the environment and replace any
 * occurrence in strings/objects with "[REDACTED]".
 */

const REDACTED = '[REDACTED]';

/**
 * Build a redactor function from a list of secret env-var names.
 * Resolves current env values at construction time so the redactor is a pure function.
 */
export function buildRedactor(secretNames: string[]): (input: string) => string {
  // Collect non-empty secret values from the environment
  const secretValues: string[] = [];
  for (const name of secretNames) {
    const val = process.env[name];
    if (val && val.trim().length > 0) {
      secretValues.push(val);
    }
  }

  if (secretValues.length === 0) {
    // Nothing to redact — return identity
    return (s) => s;
  }

  // Sort by length descending so longer secrets are replaced first (avoids partial replacements)
  const sorted = [...secretValues].sort((a, b) => b.length - a.length);

  return (input: string): string => {
    let out = input;
    for (const secret of sorted) {
      // Replace all occurrences (global, literal string replacement)
      out = out.split(secret).join(REDACTED);
    }
    return out;
  };
}

/**
 * Redact secrets from an arbitrary unknown value.
 * Recursively processes strings, objects, and arrays.
 * Returns a new value with secrets replaced.
 */
export function redactValue(value: unknown, redact: (s: string) => string): unknown {
  if (typeof value === 'string') {
    return redact(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, redact));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = redactValue(v, redact);
    }
    return result;
  }
  return value;
}
