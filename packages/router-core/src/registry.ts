/**
 * @horus/router-core — RegistryEntry schema (Q2 locked decision).
 *
 * RegistryEntry is the per-user row stored in the SQLite registry.
 * schema_version enables future forward/backward migrations.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schema (runtime validation + static type derivation)
// ---------------------------------------------------------------------------

export const RegistryEntrySchema = z.object({
  /** Tenant namespace this entry belongs to. */
  tenant: z.string().min(1),
  /** User identifier within the tenant. */
  user: z.string().min(1),
  /** Base URL of the per-user Anvil instance. */
  url: z.string().url(),
  /**
   * Schema version for forward-compatibility migrations.
   * Increment when the registry row shape changes.
   */
  schema_version: z.number().int().min(1).default(1),
  /** Lifecycle status of this entry. */
  status: z.enum(['provisioning', 'active', 'degraded', 'deprovisioned']).default('active'),
  /** ISO-8601 timestamp of the last successful provisioning cycle. */
  last_provisioned_at: z.string().datetime({ offset: true }).optional(),
});

export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;
