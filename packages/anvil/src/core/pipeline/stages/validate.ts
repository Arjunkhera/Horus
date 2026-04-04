/**
 * Pipeline validation stage for Anvil V2 Ingestion Pipeline.
 *
 * Composes the existing field-level validator (validateNote) with
 * pipeline-level checks: type existence, edge intent validation,
 * source file accessibility, and mime type validation.
 *
 * Operates in strict mode — rejects on any failure.
 */

import { promises as fs } from 'fs';
import { TypeRegistry } from '../../../registry/type-registry.js';
import { validateNote } from '../../../registry/validator.js';
import { IntentRegistry } from '../../graph/intent-registry.js';
import type { CreateEdgeInput } from '../../graph/edge-model.js';
import type { ValidationResult, FieldValidationError } from '../../../types/schema.js';

/** Input shape for the pipeline validation stage. */
export interface ValidateEntityInput {
  /** Note type ID (e.g. 'task', 'note', 'story'). */
  type: string;
  /** Frontmatter fields to validate against the type schema. */
  fields: Record<string, unknown>;
  /** Note body content. */
  body: string;
  /** Optional edges to create alongside the entity. */
  edges?: CreateEdgeInput[];
  /** Optional filesystem path for file-type entities. */
  sourcePath?: string;
}

/**
 * Supported MIME types for file-type entities in the MVP.
 * Covers common document, image, and data formats.
 */
const SUPPORTED_MIME_TYPES = new Set([
  // Documents
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/yaml',
  'text/yaml',
  // Images
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  'image/webp',
]);

/**
 * Validate an entity for the ingestion pipeline.
 *
 * Runs all validation checks in strict mode and returns a single
 * {@link ValidationResult} that aggregates field-level and
 * pipeline-level errors.
 *
 * Validation order:
 * 1. Type existence
 * 2. Field validation (required, type checking, constraints) via existing validator
 * 3. Edge intent validation
 * 4. Source file accessibility
 * 5. MIME type validation (file-type entities only)
 */
export async function validateEntity(
  input: ValidateEntityInput,
  registry: TypeRegistry,
  intentRegistry: IntentRegistry,
): Promise<ValidationResult> {
  const errors: FieldValidationError[] = [];
  const warnings: FieldValidationError[] = [];

  // --- 1. Type existence ---
  if (!registry.hasType(input.type)) {
    errors.push({
      field: 'type',
      message: `Unknown type: "${input.type}"`,
    });
    // Cannot proceed with field validation if type is unknown
    return { valid: false, errors, warnings };
  }

  const resolvedType = registry.getType(input.type)!;

  // --- 2. Field validation (delegates to existing validator) ---
  // Pass a shallow copy so auto-population side-effects don't mutate the caller's object
  const fieldsCopy = { ...input.fields };
  const fieldResult = validateNote(fieldsCopy, resolvedType, 'strict');
  errors.push(...fieldResult.errors);
  warnings.push(...fieldResult.warnings);

  // --- 3. Edge intent validation ---
  if (input.edges && input.edges.length > 0) {
    for (const edge of input.edges) {
      if (!intentRegistry.validate(edge.intent)) {
        errors.push({
          field: 'edges',
          message: `Unknown edge intent: "${edge.intent}"`,
        });
      }
    }
  }

  // --- 4. Source file accessibility ---
  if (input.sourcePath !== undefined) {
    try {
      await fs.access(input.sourcePath, fs.constants.R_OK);
    } catch {
      errors.push({
        field: 'sourcePath',
        message: `Source file not accessible: "${input.sourcePath}"`,
      });
    }
  }

  // --- 5. MIME type validation (file-type entities) ---
  if (input.type === 'file') {
    const mimeType = input.fields.mime_type;
    if (mimeType === undefined || mimeType === null || mimeType === '') {
      errors.push({
        field: 'mime_type',
        message: 'File entities require a mime_type field',
      });
    } else if (typeof mimeType !== 'string') {
      errors.push({
        field: 'mime_type',
        message: `mime_type must be a string, got ${typeof mimeType}`,
      });
    } else if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
      errors.push({
        field: 'mime_type',
        message: `Unsupported mime type: "${mimeType}"`,
        allowed_values: Array.from(SUPPORTED_MIME_TYPES),
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
