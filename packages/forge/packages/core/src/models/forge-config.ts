import { z } from 'zod';

/**
 * V1 supports only HTTP registries (R16).
 * Filesystem and git registry types are rejected with a clear error message.
 */
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
 * Catch-all schema for unsupported registry types (filesystem, git, etc.).
 * Accepts any object with a `type` field that is not `http` and produces
 * a clear validation error: "V1 supports only type: http registries".
 */
const UnsupportedRegistrySchema = z
  .object({ type: z.string() })
  .passthrough()
  .superRefine((_val, ctx) => {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'V1 supports only type: http registries',
    });
  }) as unknown as z.ZodType<never>;

/**
 * Registry configuration schema.
 *
 * V1 supports only `type: http` registries (R16).
 * Specifying `type: filesystem` or `type: git` will fail validation
 * with the message: "V1 supports only type: http registries".
 */
export const RegistryConfigSchema = z.union([
  HttpRegistrySchema,
  UnsupportedRegistrySchema,
]);

export type RegistryConfig = z.infer<typeof RegistryConfigSchema>;

/**
 * Input variant of RegistryConfig — fields with `.default()` are optional.
 * Use this when accepting user/test input that will be parsed by Zod.
 */
export type RegistryConfigInput = z.input<typeof RegistryConfigSchema>;

/**
 * Normalize a registry config entry.
 * V1 supports only http registries; this function is a no-op but kept
 * for backward compatibility with any callers.
 */
export function normalizeRegistryConfig(reg: RegistryConfig): RegistryConfig {
  return reg;
}

/**
 * Schema for forge.yaml — the workspace configuration file.
 * @example
 * const config = ForgeConfigSchema.parse({
 *   name: 'my-workspace',
 *   version: '0.1.0',
 *   target: 'claude-code',
 *   registries: [{ type: 'http', name: 'local', url: 'https://horus.example.com/api/v1/forge', writable: true }],
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
