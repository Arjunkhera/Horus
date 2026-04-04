// Type registry: loads, validates, and resolves type definitions with inheritance

import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { AnvilDb } from '../index/sqlite.js';
import {
  TypeDefinition,
  ResolvedType,
  FieldDefinition,
  TypeBehaviors,
  TypeSource,
} from '../types/index.js';
import { AnvilError, ERROR_CODES, makeError } from '../types/index.js';

/** Zod schema to validate the structure of a type definition YAML file */
const FieldDefinitionSchema: z.ZodType<FieldDefinition> = z.lazy(() =>
  z.object({
    type: z.enum([
      'string',
      'enum',
      'date',
      'datetime',
      'number',
      'boolean',
      'tags',
      'reference',
      'reference_list',
      'text',
      'url',
      'object',
    ]),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
    immutable: z.boolean().optional(),
    auto: z.enum(['uuid', 'now']).optional(),
    min_length: z.number().optional(),
    max_length: z.number().optional(),
    pattern: z.string().optional(),
    values: z.array(z.string()).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    integer: z.boolean().optional(),
    ref_type: z.string().optional(),
    no_duplicates: z.boolean().optional(),
    fields: z.record(FieldDefinitionSchema).optional(),
    description: z.string().optional(),
    search_mode: z.enum(['term', 'text', 'both', 'none']).optional(),
  }),
);

const TypeBehaviorsSchema: z.ZodType<TypeBehaviors> = z.object({
  append_only: z.boolean().optional(),
});

const TypeDefinitionSchema: z.ZodType<TypeDefinition> = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  extends: z.string().optional(),
  fields: z.record(FieldDefinitionSchema),
  behaviors: TypeBehaviorsSchema.optional(),
  template: z
    .object({
      frontmatter: z.record(z.unknown()).optional(),
      body: z.string().optional(),
    })
    .optional(),
});

/** Service for loading and managing type definitions with inheritance resolution */
export class TypeRegistry {
  private types = new Map<string, ResolvedType>();
  private definitions = new Map<string, TypeDefinition>();
  private definitionSources = new Map<string, TypeSource>(); // Track source (directory + file + plugin) for each type
  private db?: AnvilDb;

  /**
   * Initialize the registry with an optional SQLite database for caching
   */
  constructor(db?: AnvilDb) {
    this.db = db;
  }

  /**
   * Load all type definitions from multiple directories and resolve their inheritance chains.
   * Accepts either a single string (for backward compat) or an array of directory paths.
   * First directory has highest precedence. Skips missing directories with debug-level logging.
   */
  async loadTypes(typesDirsInput: string | string[]): Promise<void | AnvilError> {
    // Normalize input: support both single string and array
    const typesDirs = Array.isArray(typesDirsInput) ? typesDirsInput : [typesDirsInput];

    // Load types from each directory in order (first wins on conflict)
    for (const typesDir of typesDirs) {
      const loadErr = await this.loadTypesFromDir(typesDir);
      if (loadErr && 'error' in loadErr) {
        // Only return error if it's not a "directory not found" error
        // For missing directories, we skip with a debug log instead
        if (loadErr.code !== ERROR_CODES.IO_ERROR || !loadErr.message.includes('Directory not found')) {
          return loadErr;
        }
        // Debug log for missing directory (silent skip)
        console.debug(`Type directory not found, skipping: ${typesDir}`);
      }
    }

    // After all directories processed, check that _core was loaded
    if (!this.definitions.has('_core')) {
      return makeError(
        ERROR_CODES.SCHEMA_ERROR,
        `Required type _core not found in any type directory`,
      );
    }

    // Resolve inheritance for all types
    for (const [typeId, definition] of this.definitions) {
      const resolved = this.resolveType(definition);
      if ('error' in resolved) {
        return resolved;
      }
      this.types.set(typeId, resolved);
    }

    // Cache in SQLite if available
    if (this.db) {
      await this.cacheTypesToDb();
    }
  }

  /**
   * Load type definitions from a single directory.
   * Returns error only for IO errors (not just missing directories).
   * Precedence rule: if a type ID is already loaded, skip it and log a warning.
   */
  private async loadTypesFromDir(typesDir: string): Promise<void | AnvilError> {
    try {
      const files = await fs.readdir(typesDir);
      const yamlFiles = files.filter((f) => f.endsWith('.yaml'));

      // Empty directory is OK, just skip silently
      if (yamlFiles.length === 0) {
        return;
      }

      // Load _core.yaml first
      const coreIndex = yamlFiles.indexOf('_core.yaml');
      if (coreIndex !== -1) {
        yamlFiles.splice(coreIndex, 1);
        yamlFiles.unshift('_core.yaml');
      }

      // Parse all YAML files
      for (const file of yamlFiles) {
        const filePath = path.join(typesDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const raw = yaml.load(content) as unknown;

        // Validate structure with zod
        try {
          const definition = TypeDefinitionSchema.parse(raw);

          // Check for conflict: type ID already loaded from different directory
          if (this.definitions.has(definition.id)) {
            const existingSource = this.definitionSources.get(definition.id);
            if (existingSource) {
              const existingDisplay = existingSource.plugin
                ? `${existingSource.directory}/${existingSource.file} (plugin: ${existingSource.plugin})`
                : `${existingSource.directory}/${existingSource.file}`;
              const newDisplay = `${typesDir}/${file}`;
              console.warn(
                `Type conflict: '${definition.id}' defined in both ${newDisplay} and ${existingDisplay}. Using ${existingDisplay} (higher precedence).`,
              );
            }
            continue;
          }

          // Record source for this type
          const source: TypeSource = {
            directory: typesDir,
            file: file,
            plugin: this.extractPluginName(typesDir),
          };

          this.definitions.set(definition.id, definition);
          this.definitionSources.set(definition.id, source);
        } catch (err) {
          if (err instanceof z.ZodError) {
            return makeError(
              ERROR_CODES.SCHEMA_ERROR,
              `Invalid type schema in ${file}: ${err.errors[0]?.message || 'unknown error'}`,
            );
          }
          throw err;
        }
      }
    } catch (err) {
      if (err instanceof Error) {
        // Check if it's a "directory not found" error (ENOENT)
        const isNotFound = (err as unknown as Record<string, unknown>)['code'] === 'ENOENT';
        const errMsg = isNotFound
          ? `Directory not found: ${typesDir}`
          : `Failed to load types from ${typesDir}: ${err.message}`;
        return makeError(ERROR_CODES.IO_ERROR, errMsg);
      }
      throw err;
    }
  }

  /**
   * Get a resolved type by ID
   */
  getType(typeId: string): ResolvedType | undefined {
    return this.types.get(typeId);
  }

  /**
   * Get all resolved types
   */
  getAllTypes(): ResolvedType[] {
    return Array.from(this.types.values());
  }

  /**
   * Check if a type exists
   */
  hasType(typeId: string): boolean {
    return this.types.has(typeId);
  }

  /**
   * Resolve a type definition: merge fields from inheritance chain.
   * _core is implicit parent. Validates inheritance: no circular refs, max 3 levels.
   */
  private resolveType(
    definition: TypeDefinition,
  ): ResolvedType | AnvilError {
    // Build inheritance chain (child → parent → _core)
    const chain: TypeDefinition[] = [definition];
    let current = definition;
    let depth = 1;

    while (current.extends) {
      depth++;

      if (depth > 3) {
        return makeError(
          ERROR_CODES.SCHEMA_ERROR,
          `Type inheritance too deep (max 3 levels): ${definition.id}`,
        );
      }

      const parent = this.definitions.get(current.extends);
      if (!parent) {
        return makeError(
          ERROR_CODES.TYPE_NOT_FOUND,
          `Unknown parent type: ${current.extends} (parent of ${definition.id})`,
        );
      }

      // Detect circular inheritance
      if (chain.some((t) => t.id === parent.id)) {
        return makeError(
          ERROR_CODES.SCHEMA_ERROR,
          `Circular inheritance detected in type ${definition.id}`,
        );
      }

      chain.push(parent);
      current = parent;
    }

    // Implicit _core as root (if not already present)
    if (!chain.some((t) => t.id === '_core') && definition.id !== '_core') {
      const coreType = this.definitions.get('_core');
      if (coreType) {
        chain.push(coreType);
      }
    }

    // Merge fields from inheritance chain (reverse: root → leaf)
    const mergedFields: Record<string, FieldDefinition> = {};
    const ownFields: Record<string, FieldDefinition> = { ...definition.fields };

    for (let i = chain.length - 1; i >= 0; i--) {
      const t = chain[i];
      for (const [fieldName, fieldDef] of Object.entries(t.fields)) {
        mergedFields[fieldName] = fieldDef;
      }
    }

    // Get source metadata for this type
    const source = this.definitionSources.get(definition.id) || {
      directory: '',
      file: '',
    };

    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      icon: definition.icon,
      extends: definition.extends,
      fields: mergedFields,
      behaviors: definition.behaviors || {},
      template: definition.template,
      ownFields,
      source,
    };
  }

  /**
   * Extract plugin name from a directory path.
   * If the path matches /.anvil/plugins/{name}/types, returns {name}.
   * Otherwise returns undefined.
   */
  private extractPluginName(dir: string): string | undefined {
    const match = dir.match(/\.anvil[/\\]plugins[/\\]([^/\\]+)[/\\]types$/);
    return match ? match[1] : undefined;
  }

  /**
   * Get all types from a specific source directory or plugin name.
   * dirOrPlugin can be either an absolute directory path or a plugin name.
   */
  getTypesBySource(dirOrPlugin: string): ResolvedType[] {
    return this.getAllTypes().filter((type) => {
      if (!type.source) return false;
      // Check if it matches the directory path
      if (type.source.directory === dirOrPlugin) return true;
      // Check if it matches the plugin name
      if (type.source.plugin === dirOrPlugin) return true;
      return false;
    });
  }

  /**
   * Convenience method: get all types contributed by a specific plugin.
   * pluginName should be the name under .anvil/plugins/{name}/types/
   */
  getTypesByPlugin(pluginName: string): ResolvedType[] {
    return this.getAllTypes().filter((type) => type.source?.plugin === pluginName);
  }

  /**
   * Reload all type definitions from the given directories.
   * Clears the current state and performs a fresh load.
   * On failure, the previous state is preserved.
   * Returns undefined on success, or an AnvilError on failure.
   */
  async reload(dirs: string[]): Promise<void | AnvilError> {
    // Snapshot current state
    const previousTypes = new Map(this.types);
    const previousDefinitions = new Map(this.definitions);
    const previousSources = new Map(this.definitionSources);

    // Clear and reload
    this.types.clear();
    this.definitions.clear();
    this.definitionSources.clear();

    const result = await this.loadTypes(dirs);

    if (result && 'error' in result) {
      // Restore previous state on failure
      this.types = previousTypes;
      this.definitions = previousDefinitions;
      this.definitionSources = previousSources;
      console.error(`Type reload failed, keeping previous types: ${result.message}`);
      return result;
    }

    console.info(`Type registry reloaded successfully. ${this.types.size} types loaded.`);
  }

  /**
   * Cache resolved types to SQLite `types` table (if db available)
   */
  private async cacheTypesToDb(): Promise<void> {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS types (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        icon TEXT,
        extends TEXT,
        fields_json TEXT NOT NULL,
        behaviors_json TEXT NOT NULL,
        template_json TEXT,
        own_fields_json TEXT NOT NULL,
        cached_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const insertSql = `
      INSERT OR REPLACE INTO types
      (id, name, description, icon, extends, fields_json, behaviors_json, template_json, own_fields_json, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;

    for (const resolved of this.types.values()) {
      this.db.run(insertSql, [
        resolved.id,
        resolved.name,
        resolved.description || null,
        resolved.icon || null,
        resolved.extends || null,
        JSON.stringify(resolved.fields),
        JSON.stringify(resolved.behaviors),
        resolved.template ? JSON.stringify(resolved.template) : null,
        JSON.stringify(resolved.ownFields),
      ]);
    }
  }
}
