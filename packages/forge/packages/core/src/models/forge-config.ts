import { z } from 'zod';

const FilesystemRegistrySchema = z.object({
  type: z.literal('filesystem'),
  name: z.string().min(1),
  path: z.string().min(1),
});

const GitRegistrySchema = z.object({
  type: z.literal('git'),
  name: z.string().min(1),
  url: z.string().url(),
  branch: z.string().default('main'),
  path: z.string().default('registry'),
});

const HttpRegistrySchema = z.object({
  type: z.literal('http'),
  name: z.string().min(1),
  url: z.string().url(),
  token: z.string().optional(),
});

/**
 * Discriminated union of all registry types.
 */
export const RegistryConfigSchema = z.discriminatedUnion('type', [
  FilesystemRegistrySchema,
  GitRegistrySchema,
  HttpRegistrySchema,
]);

export type RegistryConfig = z.infer<typeof RegistryConfigSchema>;

/**
 * Schema for forge.yaml — the workspace configuration file.
 * @example
 * const config = ForgeConfigSchema.parse({
 *   name: 'my-workspace',
 *   version: '0.1.0',
 *   target: 'claude-code',
 *   registries: [{ type: 'filesystem', name: 'local', path: './registry' }],
 *   artifacts: {}
 * });
 */
export const ForgeConfigSchema = z.object({
  name: z.string().min(1),
  version: z.string().default('0.1.0'),
  target: z.enum(['claude-code', 'cursor', 'plugin']).default('claude-code'),
  registries: z.array(RegistryConfigSchema).default([]),
  artifacts: z.object({
    skills: z.record(z.string(), z.string()).default({}),
    agents: z.record(z.string(), z.string()).default({}),
    plugins: z.record(z.string(), z.string()).default({}),
    'workspace-configs': z.record(z.string(), z.string()).default({}),
  }).default({}),
  outputDir: z.string().default('.'),
});

export type ForgeConfig = z.infer<typeof ForgeConfigSchema>;
export type Target = z.infer<typeof ForgeConfigSchema>['target'];
