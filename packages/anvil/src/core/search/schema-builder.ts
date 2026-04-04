// Schema builder: derives Typesense collection schema from type registry search_mode declarations

import type { CollectionCreateSchema } from 'typesense/lib/Typesense/Collections.js';
import type { TypeRegistry } from '../../registry/type-registry.js';
import type { FieldDefinition, SearchMode, ResolvedType } from '../../types/schema.js';
import type { Note } from '../../types/note.js';

const COLLECTION_NAME = 'horus_documents';
const BODY_TRUNCATE_CHARS = 20_000;

/** Typesense field definition subset we care about */
interface TsField {
  name: string;
  type: string;
  facet?: boolean;
  optional?: boolean;
  sort?: boolean;
}

/** Result of diffSchema comparison */
export type DiffAction = 'none' | 'additive' | 'recreate';

export interface DiffResult {
  action: DiffAction;
  /** Fields to add when action is 'additive' */
  fieldsToAdd?: TsField[];
  /** Fields whose facet/type changed when action is 'recreate' */
  changedFields?: string[];
}

/**
 * Builds Typesense collection schemas, query_by strings, and documents
 * from the Anvil type registry's search_mode declarations.
 */
export class SchemaBuilder {
  constructor(private registry: TypeRegistry) {}

  // ── 1. buildCollectionSchema ──────────────────────────────────────────────

  /**
   * Compute the full Typesense CollectionCreateSchema from all registered types.
   * Merges search_mode-driven fields across every type and includes the
   * mandatory base fields (id, source, type, title, body, tags, modified_at, etc.).
   */
  buildCollectionSchema(): CollectionCreateSchema {
    const fieldMap = new Map<string, TsField>();

    // Base fields that are always present — order matters for default_sorting_field
    const baseFields: TsField[] = [
      { name: 'id', type: 'string' },
      { name: 'source', type: 'string', facet: true },
      { name: 'source_type', type: 'string', facet: true },
      { name: 'title', type: 'string' },
      { name: 'body', type: 'string' },
      { name: 'tags', type: 'string[]', facet: true },
      { name: 'status', type: 'string', facet: true, optional: true },
      { name: 'priority', type: 'string', facet: true, optional: true },
      { name: 'project_id', type: 'string', facet: true, optional: true },
      { name: 'created_at', type: 'int64' },
      { name: 'modified_at', type: 'int64', sort: true },
    ];

    for (const f of baseFields) {
      fieldMap.set(f.name, f);
    }

    // Walk every registered type and add search_mode-driven fields
    const allTypes = this.registry.getAllTypes();
    for (const resolvedType of allTypes) {
      // Skip the internal _core type — its fields are already covered by base fields
      if (resolvedType.id === '_core') continue;

      for (const [fieldName, fieldDef] of Object.entries(resolvedType.fields)) {
        const mode = fieldDef.search_mode ?? 'none';
        if (mode === 'none') continue;

        // Skip fields already in the base set
        if (fieldMap.has(fieldName)) continue;

        const tsField = this.fieldDefToTypesense(fieldName, fieldDef, mode);
        if (tsField) {
          fieldMap.set(fieldName, tsField);
        }
      }
    }

    return {
      name: COLLECTION_NAME,
      fields: Array.from(fieldMap.values()) as any[],
      default_sorting_field: 'modified_at',
    };
  }

  // ── 2. buildQueryBy ───────────────────────────────────────────────────────

  /**
   * Build the comma-separated query_by string for Typesense searches.
   * Includes fields with search_mode 'text' or 'both'.
   *
   * @param typeFilter - If provided, only include fields from that specific type.
   *                     If omitted, include text/both fields across all types.
   * @returns Comma-separated field names for query_by, always starting with title,body.
   */
  buildQueryBy(typeFilter?: string): string {
    // title and body are always queryable
    const queryFields = new Set<string>(['title', 'body']);

    const types = typeFilter
      ? [this.registry.getType(typeFilter)].filter(Boolean) as ResolvedType[]
      : this.registry.getAllTypes();

    for (const resolvedType of types) {
      if (resolvedType.id === '_core') continue;

      for (const [fieldName, fieldDef] of Object.entries(resolvedType.fields)) {
        const mode = fieldDef.search_mode ?? 'none';
        if (mode === 'text' || mode === 'both') {
          queryFields.add(fieldName);
        }
      }
    }

    return Array.from(queryFields).join(',');
  }

  // ── 3. buildDocument ──────────────────────────────────────────────────────

  /**
   * Convert an Anvil Note to a Typesense document, including fields
   * per their search_mode declarations.
   */
  buildDocument(note: Note): Record<string, unknown> {
    const doc: Record<string, unknown> = {
      id: note.noteId,
      source: 'anvil',
      source_type: note.type,
      title: note.title,
      body: note.body ? note.body.slice(0, BODY_TRUNCATE_CHARS) : '',
      tags: note.tags ?? [],
      created_at: Math.floor(new Date(note.created).getTime() / 1000),
      modified_at: Math.floor(new Date(note.modified).getTime() / 1000),
    };

    // Include common optional core fields
    if (note.status) doc.status = note.status;
    if (note.priority) doc.priority = note.priority;

    // Extract project_id from wiki-link reference
    const projectRef = note.fields?.project;
    const projectId = extractWikiLinkId(projectRef);
    if (projectId) doc.project_id = projectId;

    // Add type-specific fields based on search_mode
    const resolvedType = this.registry.getType(note.type);
    if (resolvedType) {
      for (const [fieldName, fieldDef] of Object.entries(resolvedType.fields)) {
        const mode = fieldDef.search_mode ?? 'none';
        if (mode === 'none') continue;

        // Skip fields already handled above
        if (doc[fieldName] !== undefined) continue;

        const value = this.extractFieldValue(note, fieldName, fieldDef);
        if (value !== undefined && value !== null && value !== '') {
          doc[fieldName] = value;
        }
      }
    }

    return doc;
  }

  // ── 4. diffSchema ─────────────────────────────────────────────────────────

  /**
   * Compare current Typesense fields against the computed schema to determine
   * the required migration action.
   *
   * @param currentFields - Fields from the existing Typesense collection
   * @param computedFields - Fields from buildCollectionSchema()
   * @returns DiffResult with action and details
   */
  diffSchema(
    currentFields: Array<{ name: string; type: string; facet?: boolean }>,
    computedFields: Array<{ name: string; type: string; facet?: boolean }>,
  ): DiffResult {
    const currentMap = new Map(currentFields.map((f) => [f.name, f]));
    const computedMap = new Map(computedFields.map((f) => [f.name, f]));

    const fieldsToAdd: TsField[] = [];
    const changedFields: string[] = [];

    for (const [name, computed] of computedMap) {
      const current = currentMap.get(name);

      if (!current) {
        // New field — can be added via alter API
        fieldsToAdd.push(computed as TsField);
        continue;
      }

      // Check for breaking changes: type change or facet change
      if (current.type !== computed.type || Boolean(current.facet) !== Boolean(computed.facet)) {
        changedFields.push(name);
      }
    }

    if (changedFields.length > 0) {
      return { action: 'recreate', changedFields };
    }

    if (fieldsToAdd.length > 0) {
      return { action: 'additive', fieldsToAdd };
    }

    return { action: 'none' };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Map an Anvil FieldDefinition + search_mode to a Typesense field spec.
   */
  private fieldDefToTypesense(
    name: string,
    fieldDef: FieldDefinition,
    mode: SearchMode,
  ): TsField | null {
    const tsType = this.anvilTypeToTypesense(fieldDef.type);

    switch (mode) {
      case 'term':
        // Filter/facet only — not included in query_by
        return { name, type: tsType, facet: true, optional: true };

      case 'text':
        // Full-text searchable — included in query_by, no facet
        return { name, type: tsType, optional: true };

      case 'both':
        // Full-text searchable AND filterable
        return { name, type: tsType, facet: true, optional: true };

      case 'none':
        return null;

      default:
        return null;
    }
  }

  /**
   * Map Anvil schema field types to Typesense field types.
   */
  private anvilTypeToTypesense(anvilType: FieldDefinition['type']): string {
    switch (anvilType) {
      case 'string':
      case 'enum':
      case 'text':
      case 'url':
      case 'reference':
        return 'string';

      case 'tags':
      case 'reference_list':
        return 'string[]';

      case 'number':
        return 'float';

      case 'boolean':
        return 'bool';

      case 'date':
      case 'datetime':
        return 'int64';

      case 'object':
        // Objects are serialized to JSON string for search
        return 'string';

      default:
        return 'string';
    }
  }

  /**
   * Extract a field value from a Note for indexing.
   * Checks common metadata fields first, then falls back to note.fields.
   */
  private extractFieldValue(
    note: Note,
    fieldName: string,
    fieldDef: FieldDefinition,
  ): unknown {
    // Check top-level note metadata properties
    const metaValue = (note as Record<string, unknown>)[fieldName];
    if (metaValue !== undefined) {
      return this.coerceValue(metaValue, fieldDef);
    }

    // Check note.fields (type-specific frontmatter)
    const fieldValue = note.fields?.[fieldName];
    if (fieldValue !== undefined) {
      return this.coerceValue(fieldValue, fieldDef);
    }

    // Check scope sub-fields (e.g. scope.context, scope.team)
    if (fieldName.startsWith('scope_') && note.scope) {
      const scopeKey = fieldName.replace('scope_', '') as keyof typeof note.scope;
      return note.scope[scopeKey];
    }

    return undefined;
  }

  /**
   * Coerce a raw field value into the appropriate Typesense-compatible format.
   */
  private coerceValue(value: unknown, fieldDef: FieldDefinition): unknown {
    if (value === null || value === undefined) return undefined;

    switch (fieldDef.type) {
      case 'date':
      case 'datetime': {
        // Convert ISO strings to unix epoch seconds
        if (typeof value === 'string') {
          const ts = new Date(value).getTime();
          return Number.isNaN(ts) ? undefined : Math.floor(ts / 1000);
        }
        return typeof value === 'number' ? value : undefined;
      }

      case 'tags':
      case 'reference_list':
        return Array.isArray(value) ? value.map(String) : [String(value)];

      case 'number':
        return typeof value === 'number' ? value : Number(value) || undefined;

      case 'boolean':
        return typeof value === 'boolean' ? value : value === 'true';

      case 'reference': {
        // Extract ID from wiki-link if present
        const id = extractWikiLinkId(value);
        return id ?? String(value);
      }

      case 'object':
        return typeof value === 'string' ? value : JSON.stringify(value);

      default:
        return String(value);
    }
  }
}

/** Extract UUID from a wiki-link string like [[uuid]] */
function extractWikiLinkId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const m = value.match(/\[\[([^\]]+)\]\]/);
  return m?.[1];
}
