// Handler for anvil_create_type tool

import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { FieldDefinition, TypeDefinition, ResolvedType, AnvilError } from '../types/index.js';
import { makeError, ERROR_CODES } from '../types/index.js';
import type { ToolContext } from './create-note.js';

/** Input shape for field definitions from the MCP tool */
export type FieldDefinitionInput = {
  type: FieldDefinition['type'];
  required?: boolean;
  default?: unknown;
  immutable?: boolean;
  auto?: 'uuid' | 'now';
  min_length?: number;
  max_length?: number;
  pattern?: string;
  values?: string[];
  min?: number;
  max?: number;
  integer?: boolean;
  ref_type?: string;
  no_duplicates?: boolean;
  fields?: Record<string, FieldDefinitionInput>;
  description?: string;
  search_mode?: FieldDefinition['search_mode'];
};

/** Input params for anvil_create_type */
export type CreateTypeInput = {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  extends?: string;
  fields: Record<string, FieldDefinitionInput>;
};

/**
 * Handle anvil_create_type request.
 * Creates a new custom type definition, validates against the registry,
 * writes YAML to the vault's custom-types/ directory, and reloads the registry.
 */
export async function handleCreateType(
  params: CreateTypeInput,
  ctx: ToolContext,
): Promise<ResolvedType | AnvilError> {
  try {
    // 1. Validate type ID format
    if (!/^[a-z][a-z0-9_-]*$/.test(params.id)) {
      return makeError(
        ERROR_CODES.VALIDATION_ERROR,
        `Invalid type ID "${params.id}": must start with a lowercase letter and contain only lowercase letters, digits, hyphens, and underscores`,
      );
    }

    // 2. Check for conflicts with existing types
    if (ctx.registry.hasType(params.id)) {
      return makeError(
        ERROR_CODES.CONFLICT,
        `Type "${params.id}" already exists`,
      );
    }

    // 3. Validate parent type if extends is provided
    let parentType: ResolvedType | undefined;
    if (params.extends) {
      parentType = ctx.registry.getType(params.extends);
      if (!parentType) {
        return makeError(
          ERROR_CODES.TYPE_NOT_FOUND,
          `Parent type not found: ${params.extends}`,
        );
      }
    }

    // 4. Check field name collisions with parent chain
    if (parentType) {
      const parentFieldNames = Object.keys(parentType.fields);
      const conflicting = Object.keys(params.fields).filter((f) =>
        parentFieldNames.includes(f),
      );
      if (conflicting.length > 0) {
        return makeError(
          ERROR_CODES.CONFLICT,
          `Field name(s) conflict with parent type "${params.extends}": ${conflicting.join(', ')}`,
        );
      }
    }

    // 5. Build the TypeDefinition YAML structure
    const typeDefinition: TypeDefinition = {
      id: params.id,
      name: params.name,
      ...(params.description && { description: params.description }),
      ...(params.icon && { icon: params.icon }),
      ...(params.extends && { extends: params.extends }),
      fields: params.fields as Record<string, FieldDefinition>,
    };

    // 6. Determine custom-types directory and ensure it exists
    const customTypesDir = path.join(ctx.vaultPath, 'custom-types');
    await fs.mkdir(customTypesDir, { recursive: true });

    // 7. Write YAML file
    const filePath = path.join(customTypesDir, `${params.id}.yaml`);

    // Check if file already exists (belt-and-suspenders)
    try {
      await fs.access(filePath);
      return makeError(
        ERROR_CODES.CONFLICT,
        `Type file already exists: ${filePath}`,
      );
    } catch {
      // File doesn't exist — expected
    }

    const yamlContent = yaml.dump(typeDefinition, {
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
    });
    await fs.writeFile(filePath, yamlContent, 'utf-8');

    // 8. Reload the type registry to pick up the new type
    //    Build dirs list: the standard .anvil/types + custom-types
    const typesDir = path.join(ctx.vaultPath, '.anvil', 'types');
    const reloadDirs = [typesDir, customTypesDir];
    const reloadErr = await ctx.registry.reload(reloadDirs);
    if (reloadErr && 'error' in reloadErr) {
      return makeError(
        ERROR_CODES.SERVER_ERROR,
        `Type created but registry reload failed: ${reloadErr.message}`,
      );
    }

    // 9. Return the resolved type
    const resolved = ctx.registry.getType(params.id);
    if (!resolved) {
      return makeError(
        ERROR_CODES.SERVER_ERROR,
        `Type was written but could not be resolved after reload`,
      );
    }

    return resolved;
  } catch (err) {
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      `Unexpected error creating type: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
