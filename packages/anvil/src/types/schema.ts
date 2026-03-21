// TypeScript types for the Anvil type registry — type definitions, field specs, validation

export type FieldType =
  | 'string'
  | 'enum'
  | 'date'
  | 'datetime'
  | 'number'
  | 'boolean'
  | 'tags'
  | 'reference'
  | 'reference_list'
  | 'text'
  | 'url'
  | 'object';

/** Definition for a single field in a type template */
export type FieldDefinition = {
  type: FieldType;
  required?: boolean;
  default?: unknown;
  immutable?: boolean;
  /** Auto-population strategy */
  auto?: 'uuid' | 'now';

  // string constraints
  min_length?: number;
  max_length?: number;
  pattern?: string;

  // enum constraints
  values?: string[];

  // number constraints
  min?: number;
  max?: number;
  integer?: boolean;

  // reference constraints
  ref_type?: string; // must link to a note of this type

  // tags / reference_list
  no_duplicates?: boolean;

  // object (nested fields, used for 'scope')
  fields?: Record<string, FieldDefinition>;

  // display hint
  description?: string;
};

/** Behavioral flags declared at the type level */
export type TypeBehaviors = {
  /** If true, note body can only be appended to, never replaced */
  append_only?: boolean;
};

/** Default frontmatter + body template for new notes */
export type TypeTemplate = {
  frontmatter?: Record<string, unknown>;
  body?: string;
};

/** Raw type definition as parsed from a .anvil/types/*.yaml file */
export type TypeDefinition = {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  /** Parent type to inherit fields from */
  extends?: string;
  fields: Record<string, FieldDefinition>;
  behaviors?: TypeBehaviors;
  template?: TypeTemplate;
};

/** Metadata tracking the source of a type definition */
export type TypeSource = {
  directory: string;   // absolute path to the types/ directory
  file: string;        // filename, e.g. "work-item.yaml"
  plugin?: string;     // plugin name if from .anvil/plugins/{name}/types/
};

/**
 * A resolved type has its full field set already merged with parent fields.
 * Consumers never need to walk the inheritance chain.
 */
export type ResolvedType = {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  extends?: string;
  /** All fields merged from the inheritance chain (core → parent → child) */
  fields: Record<string, FieldDefinition>;
  behaviors: TypeBehaviors;
  template?: TypeTemplate;
  /** Only fields defined directly on this type (not inherited) */
  ownFields: Record<string, FieldDefinition>;
  /** Source tracking: which directory and file this type came from */
  source: TypeSource;
};

export type ValidationMode = 'strict' | 'warn';

export type FieldValidationError = {
  field: string;
  message: string;
  allowed_values?: string[];
};

/** Result of validating a note's frontmatter against its type schema */
export type ValidationResult = {
  valid: boolean;
  errors: FieldValidationError[];
  warnings: FieldValidationError[];
};
