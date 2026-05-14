/**
 * Centralized V1 type registry.
 *
 * This module declares the 5 V1 artifact types, their human-readable metadata,
 * their Zod schemas (imported from @forge/core), and the allowed reference
 * targets per type. It is the single source of truth for type system knowledge
 * referenced by the discovery endpoints (story 1a.5) and downstream stories
 * (1a.6, Phase B).
 *
 * Allowed reference targets (from design doc §4.2.3):
 *   skill           → []
 *   agent           → ['skill']
 *   plugin          → ['skill']
 *   persona         → []
 *   workspace-config→ ['plugin', 'skill']
 */

import type { ZodSchema } from 'zod';
import type { ArtifactType } from '@forge/core';
import {
  SkillMetaSchema,
  AgentMetaSchema,
  PluginMetaSchema,
  PersonaMetaSchema,
  WorkspaceConfigMetaSchema,
} from '@forge/core';

// ---------------------------------------------------------------------------
// Type declarations
// ---------------------------------------------------------------------------

export interface TypeRegistryEntry {
  typeId: ArtifactType;
  name: string;
  description: string;
  schemaVersion: string;
  schema: ZodSchema;
  allowedReferenceTargets: ArtifactType[];
}

// ---------------------------------------------------------------------------
// Registry data
// ---------------------------------------------------------------------------

const REGISTRY_ENTRIES: TypeRegistryEntry[] = [
  {
    typeId: 'skill',
    name: 'Skill',
    description: 'A reusable prompt-based capability that can be composed into agents and workflows.',
    schemaVersion: '1',
    schema: SkillMetaSchema,
    allowedReferenceTargets: [],
  },
  {
    typeId: 'agent',
    name: 'Agent',
    description: 'A named AI agent configuration with a root skill and a set of dependent skills.',
    schemaVersion: '1',
    schema: AgentMetaSchema,
    allowedReferenceTargets: ['skill'],
  },
  {
    typeId: 'plugin',
    name: 'Plugin',
    description: 'An MCP server or tool plugin that extends the Forge runtime with external capabilities.',
    schemaVersion: '1',
    schema: PluginMetaSchema,
    allowedReferenceTargets: ['skill'],
  },
  {
    typeId: 'persona',
    name: 'Persona',
    description: 'A behavioral persona that shapes the style and tone of AI interactions.',
    schemaVersion: '1',
    schema: PersonaMetaSchema,
    allowedReferenceTargets: [],
  },
  {
    typeId: 'workspace-config',
    name: 'Workspace Config',
    description: 'A shareable workspace configuration bundle (plugins, skills, MCP endpoints, git workflow).',
    schemaVersion: '1',
    schema: WorkspaceConfigMetaSchema,
    allowedReferenceTargets: ['plugin', 'skill'],
  },
];

// ---------------------------------------------------------------------------
// Exports — indexed for O(1) lookups
// ---------------------------------------------------------------------------

/**
 * Ordered list of all V1 type registry entries.
 */
export const TYPE_REGISTRY_LIST: readonly TypeRegistryEntry[] = REGISTRY_ENTRIES;

/**
 * Map from typeId → TypeRegistryEntry for O(1) lookups.
 */
export const TYPE_REGISTRY_MAP: ReadonlyMap<ArtifactType, TypeRegistryEntry> = new Map(
  REGISTRY_ENTRIES.map((e) => [e.typeId, e]),
);
