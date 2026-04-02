import { z } from 'zod';
import { SemVerSchema } from './skill-meta.js';

/**
 * Schema for metadata.yaml — describes a Forge persona artifact.
 * Personas define character profiles used by the discovery skill's
 * Agent Team mode to simulate stakeholder perspectives.
 *
 * @example
 * const meta = PersonaMetaSchema.parse({
 *   id: 'end-user',
 *   name: 'End User Persona',
 *   version: '1.0.0',
 *   description: 'Represents the end user perspective',
 *   type: 'persona',
 *   tags: ['discovery', 'stakeholder']
 * });
 */
export const PersonaMetaSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, 'ID must be lowercase kebab-case'),
  name: z.string().min(1),
  version: SemVerSchema,
  description: z.string().min(1),
  type: z.literal('persona'),
  author: z.string().optional(),
  license: z.string().optional(),
  tags: z.array(z.string()).default([]),
  homepage: z.string().url().optional(),
  repository: z.string().optional(),
});

export type PersonaMeta = z.infer<typeof PersonaMetaSchema>;
