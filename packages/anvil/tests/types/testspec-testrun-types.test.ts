/**
 * Tests for test-spec and test-run custom type definitions and the four
 * testing-flow edge intents: has_spec, ran, verifies, proof_of_work.
 *
 * Types are loaded from the defaults/ directory (no external vault required).
 * Intent tests exercise IntentRegistry in isolation.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { join } from 'path'

import { TypeRegistry } from '../../src/registry/type-registry.js'
import { IntentRegistry } from '../../src/core/graph/intent-registry.js'
import { isAnvilError } from '../../src/types/error.js'

const DEFAULTS_DIR = join(process.cwd(), 'defaults')

// =============================================================================
// Type Registry: test-spec
// =============================================================================

describe('test-spec type', () => {
  let registry: TypeRegistry

  beforeAll(async () => {
    registry = new TypeRegistry()
    const err = await registry.loadTypes(DEFAULTS_DIR)
    if (isAnvilError(err)) {
      throw new Error(`Failed to load types: ${err.message}`)
    }
  })

  it('should load test-spec type from defaults', () => {
    const type = registry.getType('test-spec')
    expect(type).toBeDefined()
    expect(type!.id).toBe('test-spec')
    expect(type!.name).toBe('Test Spec')
  })

  it('should have a story reference field (required)', () => {
    const type = registry.getType('test-spec')
    const field = type!.fields.story
    expect(field).toBeDefined()
    expect(field!.type).toBe('reference')
    expect(field!.ref_type).toBe('story')
    expect(field!.required).toBe(true)
  })

  it('should have an immutable commit field (required)', () => {
    const type = registry.getType('test-spec')
    const field = type!.fields.commit
    expect(field).toBeDefined()
    expect(field!.type).toBe('string')
    expect(field!.required).toBe(true)
    expect(field!.immutable).toBe(true)
  })

  it('should have a version field with default v1', () => {
    const type = registry.getType('test-spec')
    const field = type!.fields.version
    expect(field).toBeDefined()
    expect(field!.type).toBe('string')
    expect(field!.required).toBe(true)
    expect(field!.default).toBe('v1')
  })

  it('should have an optional profile field', () => {
    const type = registry.getType('test-spec')
    const field = type!.fields.profile
    expect(field).toBeDefined()
    expect(field!.type).toBe('string')
    expect(field!.required).toBeFalsy()
  })

  it('should have a generated boolean field defaulting to true', () => {
    const type = registry.getType('test-spec')
    const field = type!.fields.generated
    expect(field).toBeDefined()
    expect(field!.type).toBe('boolean')
    expect(field!.default).toBe(true)
  })

  it('should inherit core fields (noteId, title, tags, created, modified)', () => {
    const type = registry.getType('test-spec')
    expect(type!.fields.noteId).toBeDefined()
    expect(type!.fields.title).toBeDefined()
    expect(type!.fields.tags).toBeDefined()
    expect(type!.fields.created).toBeDefined()
    expect(type!.fields.modified).toBeDefined()
  })

  it('should have no behaviors (not append-only — replace-body semantics)', () => {
    const type = registry.getType('test-spec')
    expect(type!.behaviors?.append_only).toBeFalsy()
  })

  it('should have a body template', () => {
    const type = registry.getType('test-spec')
    expect(type!.template?.body).toBeDefined()
    expect(type!.template!.body).toContain('Test Specification')
  })

  it('should have story and commit search_mode set to term', () => {
    const type = registry.getType('test-spec')
    expect(type!.fields.story.search_mode).toBe('term')
    expect(type!.fields.commit.search_mode).toBe('term')
    expect(type!.fields.version.search_mode).toBe('term')
  })
})

// =============================================================================
// Type Registry: test-run
// =============================================================================

describe('test-run type', () => {
  let registry: TypeRegistry

  beforeAll(async () => {
    registry = new TypeRegistry()
    const err = await registry.loadTypes(DEFAULTS_DIR)
    if (isAnvilError(err)) {
      throw new Error(`Failed to load types: ${err.message}`)
    }
  })

  it('should load test-run type from defaults', () => {
    const type = registry.getType('test-run')
    expect(type).toBeDefined()
    expect(type!.id).toBe('test-run')
    expect(type!.name).toBe('Test Run')
  })

  it('should have append_only behavior', () => {
    const type = registry.getType('test-run')
    expect(type!.behaviors?.append_only).toBe(true)
  })

  it('should have a story reference field (required)', () => {
    const type = registry.getType('test-run')
    const field = type!.fields.story
    expect(field).toBeDefined()
    expect(field!.type).toBe('reference')
    expect(field!.ref_type).toBe('story')
    expect(field!.required).toBe(true)
  })

  it('should have a spec_version reference to test-spec (required)', () => {
    const type = registry.getType('test-run')
    const field = type!.fields.spec_version
    expect(field).toBeDefined()
    expect(field!.type).toBe('reference')
    expect(field!.ref_type).toBe('test-spec')
    expect(field!.required).toBe(true)
  })

  it('should have an immutable commit field (required)', () => {
    const type = registry.getType('test-run')
    const field = type!.fields.commit
    expect(field).toBeDefined()
    expect(field!.type).toBe('string')
    expect(field!.required).toBe(true)
    expect(field!.immutable).toBe(true)
  })

  it('should have a verdict enum field with values red, green, regression', () => {
    const type = registry.getType('test-run')
    const field = type!.fields.verdict
    expect(field).toBeDefined()
    expect(field!.type).toBe('enum')
    expect(field!.required).toBe(true)
    expect(field!.values).toEqual(['red', 'green', 'regression'])
  })

  it('should have an auto-set immutable timestamp field', () => {
    const type = registry.getType('test-run')
    const field = type!.fields.timestamp
    expect(field).toBeDefined()
    expect(field!.type).toBe('datetime')
    expect(field!.auto).toBe('now')
    expect(field!.immutable).toBe(true)
    expect(field!.required).toBe(true)
  })

  it('should have an optional profile field', () => {
    const type = registry.getType('test-run')
    const field = type!.fields.profile
    expect(field).toBeDefined()
    expect(field!.type).toBe('string')
    expect(field!.required).toBeFalsy()
  })

  it('should have a test_results text field', () => {
    const type = registry.getType('test-run')
    const field = type!.fields.test_results
    expect(field).toBeDefined()
    expect(field!.type).toBe('text')
  })

  it('should have an evidence_refs reference_list field', () => {
    const type = registry.getType('test-run')
    const field = type!.fields.evidence_refs
    expect(field).toBeDefined()
    expect(field!.type).toBe('reference_list')
  })

  it('should inherit core fields (noteId, title, tags, created, modified)', () => {
    const type = registry.getType('test-run')
    expect(type!.fields.noteId).toBeDefined()
    expect(type!.fields.title).toBeDefined()
    expect(type!.fields.tags).toBeDefined()
    expect(type!.fields.created).toBeDefined()
    expect(type!.fields.modified).toBeDefined()
  })

  it('should have verdict search_mode set to term', () => {
    const type = registry.getType('test-run')
    expect(type!.fields.verdict.search_mode).toBe('term')
    expect(type!.fields.story.search_mode).toBe('term')
    expect(type!.fields.commit.search_mode).toBe('term')
  })

  it('should have test_results and evidence_refs search_mode none', () => {
    const type = registry.getType('test-run')
    expect(type!.fields.test_results.search_mode).toBe('none')
    expect(type!.fields.evidence_refs.search_mode).toBe('none')
  })

  it('should have a body template', () => {
    const type = registry.getType('test-run')
    expect(type!.template?.body).toBeDefined()
    expect(type!.template!.body).toContain('Test Run Report')
  })
})

// =============================================================================
// IntentRegistry: testing-flow intents
// =============================================================================

describe('Testing-flow intents: has_spec, ran, verifies, proof_of_work', () => {
  let registry: IntentRegistry

  beforeAll(() => {
    registry = new IntentRegistry()
  })

  // ---- has_spec ----

  it('should have has_spec registered', () => {
    expect(registry.validate('has_spec')).toBe(true)
  })

  it('has_spec should be directional with inverse spec_of', () => {
    const intent = registry.get('has_spec')
    expect(intent).toBeDefined()
    expect(intent!.direction).toBe('directional')
    expect(intent!.inverseLabel).toBe('spec_of')
  })

  it('has_spec should return correct display labels', () => {
    expect(registry.getDisplayLabel('has_spec', 'outgoing')).toBe('has_spec')
    expect(registry.getDisplayLabel('has_spec', 'incoming')).toBe('spec_of')
  })

  // ---- ran ----

  it('should have ran registered', () => {
    expect(registry.validate('ran')).toBe(true)
  })

  it('ran should be directional with inverse run_by', () => {
    const intent = registry.get('ran')
    expect(intent).toBeDefined()
    expect(intent!.direction).toBe('directional')
    expect(intent!.inverseLabel).toBe('run_by')
  })

  it('ran should return correct display labels', () => {
    expect(registry.getDisplayLabel('ran', 'outgoing')).toBe('ran')
    expect(registry.getDisplayLabel('ran', 'incoming')).toBe('run_by')
  })

  // ---- verifies ----

  it('should have verifies registered', () => {
    expect(registry.validate('verifies')).toBe(true)
  })

  it('verifies should be directional with inverse verified_by', () => {
    const intent = registry.get('verifies')
    expect(intent).toBeDefined()
    expect(intent!.direction).toBe('directional')
    expect(intent!.inverseLabel).toBe('verified_by')
  })

  it('verifies should return correct display labels', () => {
    expect(registry.getDisplayLabel('verifies', 'outgoing')).toBe('verifies')
    expect(registry.getDisplayLabel('verifies', 'incoming')).toBe('verified_by')
  })

  // ---- proof_of_work ----

  it('should have proof_of_work registered', () => {
    expect(registry.validate('proof_of_work')).toBe(true)
  })

  it('proof_of_work should be directional with inverse proves', () => {
    const intent = registry.get('proof_of_work')
    expect(intent).toBeDefined()
    expect(intent!.direction).toBe('directional')
    expect(intent!.inverseLabel).toBe('proves')
  })

  it('proof_of_work should return correct display labels', () => {
    expect(registry.getDisplayLabel('proof_of_work', 'outgoing')).toBe('proof_of_work')
    expect(registry.getDisplayLabel('proof_of_work', 'incoming')).toBe('proves')
  })

  // ---- registry completeness ----

  it('all four testing intents should appear in list()', () => {
    const ids = registry.list().map((i) => i.id)
    expect(ids).toContain('has_spec')
    expect(ids).toContain('ran')
    expect(ids).toContain('verifies')
    expect(ids).toContain('proof_of_work')
  })

  it('should still have all MVP intents alongside testing intents', () => {
    expect(registry.validate('mentions')).toBe(true)
    expect(registry.validate('blocks')).toBe(true)
    expect(registry.validate('references')).toBe(true)
    expect(registry.validate('parent_of')).toBe(true)
    expect(registry.validate('belongs_to')).toBe(true)
  })

  it('total intent count should be 9 (5 MVP + 4 testing)', () => {
    expect(registry.list().length).toBe(9)
  })

  it('duplicate registration of has_spec should throw', () => {
    expect(() =>
      registry.register({
        id: 'has_spec',
        direction: 'directional',
        inverseLabel: 'spec_of',
        description: 'Duplicate',
      }),
    ).toThrow()
  })
})
