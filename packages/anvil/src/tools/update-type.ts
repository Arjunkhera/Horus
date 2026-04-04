// Handler for anvil_update_type tool

import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { FieldDefinition, TypeDefinition, ResolvedType, AnvilError } from '../types/index.js';
import { makeError, ERROR_CODES } from '../types/index.js';
import type { ToolContext } from './create-note.js';
import type { FieldDefinitionInput } from './create-type.js';

/** Input params for anvil_update_type */
export type UpdateTypeInput = {
  typeId: string;
  fields: Record<string, FieldDefinitionInput>;
};

/**
 * Handle anvil_update_type request.
 * Adds new fields to an existing custom type definition.
 * Only add-only: cannot modify existing fields, cannot update built-in types.
 */
export async function handleUpdateType(
  params: UpdateTypeInput,
  ctx: ToolContext,
): Promise<ResolvedType | AnvilError> {
  try {
    // 1. Validate type exists
    const existingType = ctx.registry.getType(params.typeId);
    if (!existingType) {
      return makeError(
        ERROR_CODES.TYPE_NOT_FOUND,
        `Type not found: ${params.typeId}`,
      );
    }

    // 2. Reject if type is built-in (source directory is defaults/)
    const source = existingType.source;
    if (!source || !source.directory) {
      return makeError(
        ERROR_CODES.VALIDATION_ERROR,
        `Cannot update type "${params.typeId}": unable to determine source directory`,
      );
    }

    // Built-in types are those loaded from the defaults/ directory or .anvil/types/
    // (which is seeded from defaults/). Custom types live in custom-types/.
    const normalizedDir = source.directory.replace(/\\/g, '/');
    const isBuiltIn =
      normalizedDir.endsWith('/defaults') ||
      normalizedDir.endsWith('/.anvil/types');
    if (isBuiltIn) {
      return makeError(
        ERROR_CODES.VALIDATION_ERROR,
        `Cannot update built-in type "${params.typeId}". Only custom types can be modified.`,
      );
    }

    // 3. Add-only: reject if any new field names already exist on the type
    const existingFieldNames = Object.keys(existingType.fields);
    const conflictingWithExisting = Object.keys(params.fields).filter((f) =>
      existingFieldNames.includes(f),
    );
    if (conflictingWithExisting.length > 0) {
      return makeError(
        ERROR_CODES.CONFLICT,
        `Cannot modify existing fields. The following field(s) already exist on type "${params.typeId}": ${conflictingWithExisting.join(', ')}`,
      );
    }

    // 4. Check collision with parent chain
    //    The existingType.fields already includes inherited fields,
    //    but we also need to check ownFields to distinguish.
    //    Since step 3 already checks against all merged fields (including parent),
    //    parent chain collision is already covered.

    // 5. Read the existing YAML file and update it
    const yamlFilePath = path.join(source.directory, source.file);

    let fileContent: string;
    try {
      fileContent = await fs.readFile(yamlFilePath, 'utf-8');
    } catch (err) {
      return makeError(
        ERROR_CODES.IO_ERROR,
        `Failed to read type file: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = yaml.load(fileContent) as TypeDefinition;
    if (!parsed || typeof parsed !== 'object') {
      return makeError(
        ERROR_CODES.SCHEMA_ERROR,
        `Failed to parse type file for "${params.typeId}"`,
      );
    }

    // Merge new fields into existing fields (add-only)
    const updatedFields = {
      ...parsed.fields,
      ...(params.fields as Record<string, FieldDefinition>),
    };
    parsed.fields = updatedFields;

    // 6. Write updated YAML back to file
    const yamlContent = yaml.dump(parsed, {
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
    });

    try {
      await fs.writeFile(yamlFilePath, yamlContent, 'utf-8');
    } catch (err) {
      return makeError(
        ERROR_CODES.IO_ERROR,
        `Failed to write updated type file: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 7. Reload the type registry
    const typesDir = path.join(ctx.vaultPath, '.anvil', 'types');
    const customTypesDir = path.join(ctx.vaultPath, 'custom-types');
    const reloadDirs = [typesDir, customTypesDir];
    const reloadErr = await ctx.registry.reload(reloadDirs);
    if (reloadErr && 'error' in reloadErr) {
      return makeError(
        ERROR_CODES.SERVER_ERROR,
        `Type updated but registry reload failed: ${reloadErr.message}`,
      );
    }

    // 8. Return updated type definition
    const resolved = ctx.registry.getType(params.typeId);
    if (!resolved) {
      return makeError(
        ERROR_CODES.SERVER_ERROR,
        `Type was updated but could not be resolved after reload`,
      );
    }

    return resolved;
  } catch (err) {
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      `Unexpected error updating type: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
