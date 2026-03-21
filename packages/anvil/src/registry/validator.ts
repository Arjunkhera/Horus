// Field validation engine: validates frontmatter fields against type schemas

import { v4 as uuidv4 } from 'uuid';
import {
  FieldDefinition,
  ResolvedType,
  ValidationMode,
  ValidationResult,
  FieldValidationError,
} from '../types/index.js';

/** Internal error with field context */
interface FieldError {
  field: string;
  message: string;
  allowed_values?: string[];
}

/**
 * Validate a note's frontmatter against its type schema.
 * Returns validation result with errors and warnings.
 * In strict mode, validation fails on first error.
 * In warn mode, collects all errors as warnings and continues.
 */
export function validateNote(
  frontmatter: Record<string, unknown>,
  type: ResolvedType,
  mode: ValidationMode = 'strict',
): ValidationResult {
  const errors: FieldValidationError[] = [];
  const warnings: FieldValidationError[] = [];

  // Process each field definition
  for (const [fieldName, fieldDef] of Object.entries(type.fields)) {
    const value = frontmatter[fieldName];

    // Check for immutable field updates
    if (fieldDef.immutable && value !== undefined && value !== null) {
      // Immutable fields can be set once but not updated to a different value
      // This is more of a warning/error when trying to update an existing note
      // For now, we allow initial set and flag updates
    }

    // Auto-populate fields
    if (value === undefined || value === null) {
      if (fieldDef.auto === 'uuid') {
        (frontmatter as Record<string, unknown>)[fieldName] = uuidv4();
        continue;
      }
      if (fieldDef.auto === 'now') {
        (frontmatter as Record<string, unknown>)[fieldName] = new Date()
          .toISOString();
        continue;
      }
    }

    // Check required fields
    if (
      fieldDef.required &&
      (value === undefined || value === null || value === '')
    ) {
      const err: FieldError = {
        field: fieldName,
        message: `Required field missing: ${fieldName}`,
      };
      if (mode === 'strict') {
        errors.push(err);
      } else {
        warnings.push(err);
      }
      continue;
    }

    // Skip validation if value is not provided and field not required
    if (value === undefined || value === null) {
      continue;
    }

    // Validate field based on type
    const fieldErrors = validateField(
      fieldName,
      value,
      fieldDef,
      frontmatter,
      mode,
    );

    if (fieldErrors.length > 0) {
      if (mode === 'strict') {
        errors.push(...fieldErrors);
      } else {
        warnings.push(...fieldErrors);
      }
    }
  }

  // Check for unknown fields (silently ignore)
  // Do not add to errors/warnings

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a single field value against its definition
 */
function validateField(
  fieldName: string,
  value: unknown,
  fieldDef: FieldDefinition,
  frontmatter: Record<string, unknown>,
  mode: ValidationMode,
): FieldError[] {
  const errors: FieldError[] = [];

  switch (fieldDef.type) {
    case 'string': {
      if (typeof value !== 'string') {
        errors.push({
          field: fieldName,
          message: `Expected string, got ${typeof value}`,
        });
        break;
      }
      if (
        fieldDef.min_length !== undefined &&
        value.length < fieldDef.min_length
      ) {
        errors.push({
          field: fieldName,
          message: `String too short (min ${fieldDef.min_length}): "${value}"`,
        });
      }
      if (
        fieldDef.max_length !== undefined &&
        value.length > fieldDef.max_length
      ) {
        errors.push({
          field: fieldName,
          message: `String too long (max ${fieldDef.max_length}): "${value}"`,
        });
      }
      if (fieldDef.pattern !== undefined) {
        try {
          const regex = new RegExp(fieldDef.pattern);
          if (!regex.test(value)) {
            errors.push({
              field: fieldName,
              message: `String does not match pattern: ${fieldDef.pattern}`,
            });
          }
        } catch (err) {
          errors.push({
            field: fieldName,
            message: `Invalid regex pattern: ${fieldDef.pattern}`,
          });
        }
      }
      break;
    }

    case 'enum': {
      if (typeof value !== 'string') {
        errors.push({
          field: fieldName,
          message: `Enum value must be a string, got ${typeof value}`,
          allowed_values: fieldDef.values,
        });
        break;
      }
      if (!fieldDef.values || !fieldDef.values.includes(value)) {
        errors.push({
          field: fieldName,
          message: `Invalid enum value: "${value}"`,
          allowed_values: fieldDef.values || [],
        });
      }
      break;
    }

    case 'date': {
      if (typeof value !== 'string') {
        errors.push({
          field: fieldName,
          message: `Date must be a string (ISO YYYY-MM-DD), got ${typeof value}`,
        });
        break;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        errors.push({
          field: fieldName,
          message: `Invalid date format (expected ISO YYYY-MM-DD): "${value}"`,
        });
        break;
      }
      // Validate it's a real date
      const dateObj = new Date(value + 'T00:00:00Z');
      if (isNaN(dateObj.getTime())) {
        errors.push({
          field: fieldName,
          message: `Invalid date value: "${value}"`,
        });
      }
      break;
    }

    case 'datetime': {
      if (typeof value !== 'string') {
        errors.push({
          field: fieldName,
          message: `Datetime must be a string (ISO 8601), got ${typeof value}`,
        });
        break;
      }
      const dateObj = new Date(value);
      if (isNaN(dateObj.getTime())) {
        errors.push({
          field: fieldName,
          message: `Invalid datetime value (expected ISO 8601): "${value}"`,
        });
      }
      break;
    }

    case 'number': {
      if (typeof value !== 'number') {
        errors.push({
          field: fieldName,
          message: `Expected number, got ${typeof value}`,
        });
        break;
      }
      if (fieldDef.min !== undefined && value < fieldDef.min) {
        errors.push({
          field: fieldName,
          message: `Number too small (min ${fieldDef.min}): ${value}`,
        });
      }
      if (fieldDef.max !== undefined && value > fieldDef.max) {
        errors.push({
          field: fieldName,
          message: `Number too large (max ${fieldDef.max}): ${value}`,
        });
      }
      if (fieldDef.integer && !Number.isInteger(value)) {
        errors.push({
          field: fieldName,
          message: `Expected integer, got ${value}`,
        });
      }
      break;
    }

    case 'boolean': {
      if (typeof value !== 'boolean') {
        errors.push({
          field: fieldName,
          message: `Expected boolean, got ${typeof value}`,
        });
      }
      break;
    }

    case 'tags': {
      if (!Array.isArray(value)) {
        errors.push({
          field: fieldName,
          message: `Tags must be an array, got ${typeof value}`,
        });
        break;
      }
      // Check all elements are strings
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] !== 'string') {
          errors.push({
            field: fieldName,
            message: `Tag at index ${i} is not a string: ${typeof value[i]}`,
          });
        }
      }
      // Deduplicate
      if (fieldDef.no_duplicates) {
        const unique = Array.from(new Set(value as string[]));
        if (unique.length < value.length) {
          (frontmatter as Record<string, unknown>)[fieldName] = unique;
        }
      }
      break;
    }

    case 'reference': {
      if (typeof value !== 'string') {
        errors.push({
          field: fieldName,
          message: `Reference must be a wiki-link string, got ${typeof value}`,
        });
        break;
      }
      // Validate wiki-link format: [[...]]
      if (!/^\[\[.+\]\]$/.test(value)) {
        errors.push({
          field: fieldName,
          message: `Reference must be in wiki-link format: [[Title]], got "${value}"`,
        });
        break;
      }
      // Validate ref_type if specified
      if (fieldDef.ref_type) {
        // For now, we just note this constraint exists
        // Actual type checking would require looking up the referenced note
      }
      break;
    }

    case 'reference_list': {
      if (!Array.isArray(value)) {
        errors.push({
          field: fieldName,
          message: `Reference list must be an array, got ${typeof value}`,
        });
        break;
      }
      // Check all elements are wiki-link strings
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] !== 'string') {
          errors.push({
            field: fieldName,
            message: `Reference at index ${i} is not a string: ${typeof value[i]}`,
          });
          continue;
        }
        if (!/^\[\[.+\]\]$/.test(value[i] as string)) {
          errors.push({
            field: fieldName,
            message: `Reference at index ${i} must be in wiki-link format: [[Title]], got "${value[i]}"`,
          });
        }
      }
      // Remove duplicates
      if (fieldDef.no_duplicates) {
        const unique = Array.from(new Set(value as string[]));
        if (unique.length < value.length) {
          (frontmatter as Record<string, unknown>)[fieldName] = unique;
        }
      }
      break;
    }

    case 'text': {
      if (typeof value !== 'string') {
        errors.push({
          field: fieldName,
          message: `Text must be a string, got ${typeof value}`,
        });
      }
      break;
    }

    case 'url': {
      if (typeof value !== 'string') {
        errors.push({
          field: fieldName,
          message: `URL must be a string, got ${typeof value}`,
        });
        break;
      }
      try {
        new URL(value);
      } catch {
        errors.push({
          field: fieldName,
          message: `Invalid URL: "${value}"`,
        });
      }
      break;
    }

    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push({
          field: fieldName,
          message: `Object field must be an object, got ${typeof value}`,
        });
        break;
      }
      // Validate nested fields
      if (fieldDef.fields) {
        const objVal = value as Record<string, unknown>;
        for (const [nestedName, nestedDef] of Object.entries(
          fieldDef.fields,
        )) {
          const nestedValue = objVal[nestedName];
          if (nestedValue === undefined || nestedValue === null) {
            if (nestedDef.required) {
              errors.push({
                field: `${fieldName}.${nestedName}`,
                message: `Required nested field missing`,
              });
            }
          } else {
            const nestedErrors = validateField(
              `${fieldName}.${nestedName}`,
              nestedValue,
              nestedDef,
              objVal,
              mode,
            );
            errors.push(...nestedErrors);
          }
        }
      }
      break;
    }

    default: {
      // Unknown field type
      errors.push({
        field: fieldName,
        message: `Unknown field type: ${(fieldDef as unknown as Record<string, unknown>).type}`,
      });
    }
  }

  return errors;
}
