import { z } from 'zod';

const SemVerSchema = z.string().regex(
  /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/,
  'Must be a valid semver string (e.g., 1.0.0)'
);

const SemVerRangeSchema = z.string(); // e.g., ^1.0.0, ~2.1, >=1.0.0

/**
 * Schema for metadata.yaml — describes a Forge skill artifact.
 * @example
 * const meta = SkillMetaSchema.parse({
 *   id: 'developer',
 *   name: 'Developer Skill',
 *   version: '1.0.0',
 *   description: 'Implements stories',
 *   type: 'skill',
 *   tags: ['development', 'sdlc']
 * });
 */
export const SkillMetaSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, 'ID must be lowercase kebab-case'),
  name: z.string().min(1),
  version: SemVerSchema,
  description: z.string().min(1),
  type: z.literal('skill'),
  author: z.string().optional(),
  license: z.string().optional(),
  tags: z.array(z.string()).default([]),
  dependencies: z.record(z.string(), SemVerRangeSchema).default({}),
  files: z.array(z.string()).default([]),
  homepage: z.string().url().optional(),
  repository: z.string().optional(),
});

export type SkillMeta = z.infer<typeof SkillMetaSchema>;
export { SemVerSchema, SemVerRangeSchema };
