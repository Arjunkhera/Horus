import { z } from 'zod';
import { SemVerSchema } from './skill-meta.js';

/**
 * Schema for plugin.yaml — describes a Forge plugin bundle artifact.
 * @example
 * const meta = PluginMetaSchema.parse({
 *   id: 'anvil-sdlc',
 *   name: 'Anvil SDLC Plugin',
 *   version: '1.0.0',
 *   description: 'Software development lifecycle tools',
 *   type: 'plugin',
 *   skills: ['developer', 'tester'],
 *   agents: ['sdlc-agent']
 * });
 */
export const PluginMetaSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, 'ID must be lowercase kebab-case'),
  name: z.string().min(1),
  version: SemVerSchema,
  description: z.string().min(1),
  type: z.literal('plugin'),
  author: z.string().optional(),
  license: z.string().optional(),
  tags: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  agents: z.array(z.string()).default([]),
  homepage: z.string().url().optional(),
  repository: z.string().optional(),
});

export type PluginMeta = z.infer<typeof PluginMetaSchema>;
