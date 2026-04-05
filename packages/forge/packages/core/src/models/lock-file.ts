import { z } from 'zod';

/**
 * A single locked artifact entry in forge.lock.
 */
export const LockedArtifactSchema = z.object({
  id: z.string(),
  type: z.enum(['skill', 'agent', 'plugin']),
  version: z.string(),
  registry: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'Must be a valid SHA-256 hex string'),
  files: z.array(z.string()).default([]),
  resolvedAt: z.string().datetime(),
});

/**
 * Schema for forge.lock — the lockfile tracking installed artifacts.
 * @example
 * const lock = LockFileSchema.parse({
 *   version: '1',
 *   lockedAt: new Date().toISOString(),
 *   artifacts: {}
 * });
 */
export const LockFileSchema = z.object({
  version: z.literal('1').default('1'),
  lockedAt: z.string().datetime(),
  artifacts: z.record(z.string(), LockedArtifactSchema).default({}),
});

export type LockedArtifact = z.infer<typeof LockedArtifactSchema>;
export type LockFile = z.infer<typeof LockFileSchema>;
