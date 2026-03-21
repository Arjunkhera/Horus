// Comprehensive unit tests for type registry and validation engine

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { TypeRegistry } from '../../src/registry/type-registry.js';
import { validateNote } from '../../src/registry/validator.js';
import { ResolvedType, FieldDefinition } from '../../src/types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('TypeRegistry', () => {
  let registry: TypeRegistry;

  beforeAll(async () => {
    registry = new TypeRegistry();
    const defaultsDir = path.join(__dirname, '../../defaults');
    const result = await registry.loadTypes(defaultsDir);

    // Handle error result
    if (result && typeof result === 'object' && 'error' in result) {
      throw new Error(`Failed to load types: ${(result as any).message}`);
    }
  });

  describe('Loading and basic functionality', () => {
    it('should load _core type first', () => {
      const coreType = registry.getType('_core');
      expect(coreType).toBeDefined();
      expect(coreType?.id).toBe('_core');
      expect(coreType?.fields.noteId).toBeDefined();
      expect(coreType?.fields.title).toBeDefined();
    });

    it('should load all 9 default types', () => {
      const types = registry.getAllTypes();
      const typeIds = types.map((t) => t.id).sort();
      expect(typeIds).toContain('_core');
      expect(typeIds).toContain('note');
      expect(typeIds).toContain('task');
      expect(typeIds).toContain('project');
      expect(typeIds).toContain('story');
      expect(typeIds).toContain('person');
      expect(typeIds).toContain('service');
      expect(typeIds).toContain('meeting');
      expect(typeIds).toContain('journal');
    });

    it('should report hasType correctly', () => {
      expect(registry.hasType('note')).toBe(true);
      expect(registry.hasType('nonexistent')).toBe(false);
    });
  });

  describe('Inheritance resolution', () => {
    it('should resolve story type inheriting from task', () => {
      const storyType = registry.getType('story');
      expect(storyType).toBeDefined();
      expect(storyType?.extends).toBe('task');

      // Story should have task fields (status, priority, due, effort, assignee, project)
      expect(storyType?.fields.status).toBeDefined();
      expect(storyType?.fields.priority).toBeDefined();
      expect(storyType?.fields.due).toBeDefined();
      expect(storyType?.fields.effort).toBeDefined();
      expect(storyType?.fields.assignee).toBeDefined();
      expect(storyType?.fields.project).toBeDefined();

      // Story should also have its own fields
      expect(storyType?.fields.acceptance_criteria).toBeDefined();
      expect(storyType?.fields.story_points).toBeDefined();

      // Core fields should be present
      expect(storyType?.fields.title).toBeDefined();
      expect(storyType?.fields.noteId).toBeDefined();
    });

    it('should include _core fields in all types', () => {
      const noteType = registry.getType('note');
      expect(noteType?.fields.noteId).toBeDefined();
      expect(noteType?.fields.type).toBeDefined();
      expect(noteType?.fields.title).toBeDefined();
      expect(noteType?.fields.created).toBeDefined();
      expect(noteType?.fields.modified).toBeDefined();
    });

    it('should separate ownFields from inherited fields', () => {
      const storyType = registry.getType('story');
      // ownFields should only contain fields defined directly on story
      expect(Object.keys(storyType?.ownFields ?? {})).toContain(
        'acceptance_criteria',
      );
      expect(Object.keys(storyType?.ownFields ?? {})).toContain('story_points');
      // Should not contain inherited fields
      expect(Object.keys(storyType?.ownFields ?? {})).not.toContain('status');
      expect(Object.keys(storyType?.ownFields ?? {})).not.toContain('title');
    });
  });
});

describe('Validator - Field Types', () => {
  const coreType: ResolvedType = {
    id: '_core',
    name: 'Core',
    fields: {
      noteId: { type: 'string', required: true, auto: 'uuid', immutable: true },
      title: { type: 'string', required: true, min_length: 1, max_length: 300 },
      status: {
        type: 'enum',
        values: ['open', 'done'],
        required: true,
      },
      created: { type: 'datetime', required: true, auto: 'now', immutable: true },
      modified: { type: 'datetime', required: true, auto: 'now' },
      priority: {
        type: 'enum',
        values: ['P0', 'P1', 'P2', 'P3'],
        required: false,
      },
      tags: { type: 'tags', required: false, no_duplicates: true },
      related: { type: 'reference_list', required: false, no_duplicates: true },
      due: { type: 'date', required: false },
      effort: { type: 'number', required: false, min: 1, max: 21, integer: true },
      assignee: { type: 'reference', ref_type: 'person', required: false },
      owner: { type: 'reference', ref_type: 'person', required: false },
      repo: { type: 'url', required: false },
      active: { type: 'boolean', required: false },
      bio: { type: 'text', required: false },
      scope: {
        type: 'object',
        required: false,
        fields: {
          context: { type: 'enum', values: ['personal', 'work'] },
          team: { type: 'string' },
        },
      },
    },
    behaviors: {},
    ownFields: {},
  };

  describe('String validation', () => {
    it('should validate valid string', () => {
      const result = validateNote(
        { title: 'My Note', noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject string below min_length', () => {
      const result = validateNote(
        { title: '', noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'title')).toBe(true);
    });

    it('should reject string above max_length', () => {
      const longTitle = 'a'.repeat(301);
      const result = validateNote(
        { title: longTitle, noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'title')).toBe(true);
    });

    it('should validate pattern constraint', () => {
      const typeWithPattern: ResolvedType = {
        ...coreType,
        fields: {
          ...coreType.fields,
          email: { type: 'string', pattern: '^[^@]+@[^@]+\\.[^@]+$' },
        },
      };
      const result = validateNote(
        { email: 'valid@example.com', noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        typeWithPattern,
        'strict',
      );
      expect(result.valid).toBe(true);

      const badResult = validateNote(
        { email: 'invalid-email', noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        typeWithPattern,
        'strict',
      );
      expect(badResult.valid).toBe(false);
      expect(badResult.errors.some((e) => e.field === 'email')).toBe(true);
    });
  });

  describe('Enum validation', () => {
    it('should accept valid enum value', () => {
      const result = validateNote(
        { status: 'open', priority: 'P1', noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(true);
    });

    it('should reject invalid enum value in strict mode', () => {
      const result = validateNote(
        { status: 'invalid', noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'status')).toBe(true);
      expect(result.errors[0]?.allowed_values).toEqual(['open', 'done']);
    });

    it('should warn on invalid enum value in warn mode', () => {
      const result = validateNote(
        { status: 'invalid', noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', title: 'Test' },
        coreType,
        'warn',
      );
      // In warn mode, valid is still true if no errors, but warnings are present
      expect(result.warnings.some((w) => w.field === 'status')).toBe(true);
      expect(result.warnings[0]?.allowed_values).toEqual(['open', 'done']);
    });

    it('should include allowed_values in error', () => {
      const result = validateNote(
        { status: 'bad', noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', title: 'Test' },
        coreType,
        'strict',
      );
      const statusErr = result.errors.find((e) => e.field === 'status');
      expect(statusErr?.allowed_values).toEqual(['open', 'done']);
    });
  });

  describe('Date/DateTime validation', () => {
    it('should validate ISO date (YYYY-MM-DD)', () => {
      const result = validateNote(
        { due: '2024-12-31', noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(true);
    });

    it('should reject invalid date format', () => {
      const result = validateNote(
        { due: '2024/12/31', noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'due')).toBe(true);
    });

    it('should reject invalid date value', () => {
      const result = validateNote(
        { due: '2024-13-45', noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(false);
    });

    it('should validate ISO datetime', () => {
      const result = validateNote(
        { created: '2024-01-01T12:30:45Z', modified: '2024-01-01T12:30:45Z', noteId: 'abc', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(true);
    });

    it('should reject invalid datetime', () => {
      const result = validateNote(
        { created: 'not-a-date', modified: '2024-01-01T00:00:00Z', noteId: 'abc', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('Number validation', () => {
    it('should validate number within range', () => {
      const result = validateNote(
        { effort: 5, noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(true);
    });

    it('should reject number below min', () => {
      const result = validateNote(
        { effort: 0, noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'effort')).toBe(true);
    });

    it('should reject number above max', () => {
      const result = validateNote(
        { effort: 22, noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(false);
    });

    it('should reject float when integer required', () => {
      const result = validateNote(
        { effort: 5.5, noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'effort')).toBe(true);
    });
  });

  describe('Boolean validation', () => {
    it('should accept true/false', () => {
      const result = validateNote(
        { active: true, noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(true);
    });

    it('should reject string "true"', () => {
      const result = validateNote(
        { active: 'true' as unknown as boolean, noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('Tags validation and deduplication', () => {
    it('should accept array of strings', () => {
      const result = validateNote(
        { tags: ['work', 'urgent'], noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(true);
    });

    it('should reject non-array', () => {
      const result = validateNote(
        { tags: 'work' as unknown as string[], noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(false);
    });

    it('should deduplicate tags with no_duplicates flag', () => {
      const frontmatter = { tags: ['work', 'work', 'urgent'], noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' };
      const result = validateNote(frontmatter, coreType, 'strict');
      expect(result.valid).toBe(true);
      expect(frontmatter.tags).toEqual(['work', 'urgent']);
    });
  });

  describe('Reference validation', () => {
    it('should accept wiki-link format [[...]]', () => {
      const result = validateNote(
        { assignee: '[[John Doe]]', noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(true);
    });

    it('should reject plain text reference', () => {
      const result = validateNote(
        { assignee: 'John Doe', noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'assignee')).toBe(true);
    });

    it('should validate reference_list with dedupe', () => {
      const frontmatter = { related: ['[[Note A]]', '[[Note B]]', '[[Note A]]'], noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' };
      const result = validateNote(frontmatter, coreType, 'strict');
      expect(result.valid).toBe(true);
      expect(frontmatter.related).toEqual(['[[Note A]]', '[[Note B]]']);
    });

    it('should reject invalid wiki-links in reference_list', () => {
      const result = validateNote(
        { related: ['[[Valid]]', 'Invalid'], noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('Auto-population', () => {
    it('should auto-generate UUID for auto: uuid', () => {
      const frontmatter = { created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' };
      const result = validateNote(frontmatter, coreType, 'strict');
      expect(result.valid).toBe(true);
      expect(frontmatter.noteId).toBeDefined();
      expect(typeof frontmatter.noteId).toBe('string');
      expect((frontmatter.noteId as string).length).toBeGreaterThan(0);
    });

    it('should auto-generate ISO datetime for auto: now', () => {
      const frontmatter = { noteId: 'test-id', status: 'open', title: 'Test' };
      const result = validateNote(frontmatter, coreType, 'strict');
      expect(result.valid).toBe(true);
      expect(frontmatter.created).toBeDefined();
      expect(frontmatter.modified).toBeDefined();
      // Should be ISO datetime string
      expect(new Date(frontmatter.created as string).getTime()).toBeGreaterThan(0);
    });
  });

  describe('Required field validation', () => {
    it('should error on missing required field in strict mode', () => {
      const result = validateNote(
        { noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'title')).toBe(true);
      expect(result.errors.some((e) => e.field === 'status')).toBe(true);
    });

    it('should warn on missing required field in warn mode', () => {
      const result = validateNote(
        { noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z' },
        coreType,
        'warn',
      );
      expect(result.warnings.some((w) => w.field === 'title')).toBe(true);
    });
  });

  describe('Unknown fields', () => {
    it('should silently ignore unknown fields', () => {
      const result = validateNote(
        { noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test', unknownField: 'should be ignored' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('URL validation', () => {
    it('should accept valid URL', () => {
      const result = validateNote(
        { repo: 'https://github.com/user/repo', noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(true);
    });

    it('should reject invalid URL', () => {
      const result = validateNote(
        { repo: 'not a url', noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'repo')).toBe(true);
    });
  });

  describe('Text validation', () => {
    it('should accept string text field', () => {
      const result = validateNote(
        { bio: 'This is a bio', noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(true);
    });

    it('should reject non-string text field', () => {
      const result = validateNote(
        { bio: 123 as unknown as string, noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('Object field validation', () => {
    it('should validate nested object fields', () => {
      const result = validateNote(
        { scope: { context: 'work', team: 'platform' }, noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(true);
    });

    it('should validate nested enum fields', () => {
      const result = validateNote(
        { scope: { context: 'invalid', team: 'platform' }, noteId: 'abc', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z', status: 'open', title: 'Test' },
        coreType,
        'strict',
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.startsWith('scope.'))).toBe(true);
    });
  });
});
