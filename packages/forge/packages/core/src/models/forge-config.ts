import { z } from 'zod';

const FilesystemRegistrySchema = z.object({
  type: z.literal('filesystem'),
  name: z.string().min(1),
  path: z.string().min(1),
  writable: z.boolean().default(false),
});

const GitRegistrySchema = z.object({
  type: z.literal('git'),
  name: z.string().min(1),
  url: z.string().url(),
  /**
   * Git ref (branch/tag) to check out.
   * Preferred field name. Defaults to 'main'.
   */
  ref: z.string().default('main'),
  /**
   * Legacy alias for `ref`. If both are provided, `ref` wins.
   * @deprecated Use `ref` instead.
   */
  branch: z.string().optional(),
  path: z.string().default('registry'),
  /** Environment variable name containing an auth token (e.g. FORGE_PRIVATE_REGISTRY_TOKEN). */
  tokenEnv: z.string().optional(),
  writable: z.boolean().default(false),
});

const HttpRegistrySchema = z.object({
  type: z.literal('http'),
  name: z.string().min(1),
  url: z.string().url(),
  token: z.string().optional(),
  /** Environment variable name containing an auth token. */
  tokenEnv: z.string().optional(),
  writable: z.boolean().default(false),
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
 * Normalize a git registry: resolve legacy `branch` field into `ref`.
 * Call after parsing to ensure `ref` always has the correct value.
 */
export function normalizeRegistryConfig(reg: RegistryConfig): RegistryConfig {
  if (reg.type === 'git') {
    // If branch was provided but ref is the default 'main', use branch value
    if (reg.branch && reg.ref === 'main') {
      return { ...reg, ref: reg.branch, branch: undefined };
    }
    // Strip legacy branch field
    const { branch: _, ...rest } = reg;
    return rest as RegistryConfig;
  }
  return reg;
}

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
    personas: z.record(z.string(), z.string()).default({}),
    'workspace-configs': z.record(z.string(), z.string()).default({}),
  }).default({}),
  outputDir: z.string().default('.'),
});

export type ForgeConfig = z.infer<typeof ForgeConfigSchema>;
export type Target = z.infer<typeof ForgeConfigSchema>['target'];
