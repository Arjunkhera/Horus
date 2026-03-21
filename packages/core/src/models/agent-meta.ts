import { z } from 'zod';
import { SemVerSchema, SemVerRangeSchema } from './skill-meta.js';

/**
 * Schema for agent.yaml — describes a Forge agent artifact.
 * @example
 * const meta = AgentMetaSchema.parse({
 *   id: 'sdlc-agent',
 *   name: 'SDLC Agent',
 *   version: '1.0.0',
 *   description: 'Manages software development lifecycle',
 *   type: 'agent',
 *   rootSkill: 'orchestrator'
 * });
 */
export const AgentMetaSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, 'ID must be lowercase kebab-case'),
  name: z.string().min(1),
  version: SemVerSchema,
  description: z.string().min(1),
  type: z.literal('agent'),
  rootSkill: z.string().min(1),
  author: z.string().optional(),
  license: z.string().optional(),
  tags: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  dependencies: z.record(z.string(), SemVerRangeSchema).default({}),
  homepage: z.string().url().optional(),
  repository: z.string().optional(),
});

export type AgentMeta = z.infer<typeof AgentMetaSchema>;
