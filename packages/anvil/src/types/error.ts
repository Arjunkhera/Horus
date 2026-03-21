// Structured error types used across all MCP tools and internal services

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  TYPE_NOT_FOUND: 'TYPE_NOT_FOUND',
  DUPLICATE_ID: 'DUPLICATE_ID',
  CONFLICT: 'CONFLICT',
  SYNC_ERROR: 'SYNC_ERROR',
  SERVER_ERROR: 'SERVER_ERROR',
  NO_GIT_REPO: 'NO_GIT_REPO',
  NO_REMOTE: 'NO_REMOTE',
  IMMUTABLE_FIELD: 'IMMUTABLE_FIELD',
  APPEND_ONLY: 'APPEND_ONLY',
  SCHEMA_ERROR: 'SCHEMA_ERROR',
  IO_ERROR: 'IO_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export type FieldError = {
  field: string;
  message: string;
  allowed_values?: string[];
};

/**
 * Structured error format returned by all MCP tools and service methods.
 * Never throw unhandled errors — always return this shape.
 */
export type AnvilError = {
  error: true;
  code: ErrorCode;
  message: string;
  field?: string;
  allowed_values?: string[];
  fields?: FieldError[];
};

/** Helper to construct an AnvilError */
export function makeError(
  code: ErrorCode,
  message: string,
  extra?: Partial<Omit<AnvilError, 'error' | 'code' | 'message'>>,
): AnvilError {
  return { error: true, code, message, ...extra };
}

/** Type guard for AnvilError */
export function isAnvilError(value: unknown): value is AnvilError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    (value as Record<string, unknown>)['error'] === true
  );
}
