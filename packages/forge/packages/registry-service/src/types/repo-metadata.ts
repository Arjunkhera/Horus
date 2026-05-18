import { z } from 'zod';

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

export const HostSchema = z.object({
  url: z.string(),
  provider: z.enum(['github', 'gitlab', 'bitbucket', 'other']),
  apiUrl: z.string().url().optional(),
});

export const CredentialSchema = z.object({
  type: z.enum(['ssh-host', 'gh-cli', 'token-env', 'git-credential', 'mcp-tool']),
  label: z.string(),
  mcpServer: z.string().optional(),
});

export const WorkflowSchema = z.object({
  type: z.enum(['owner', 'fork', 'contributor']),
  pushTo: z.string(),
  prTarget: z.object({
    repo: z.string(),
    branch: z.string(),
  }),
  branchPattern: z.string().optional(),
  commitFormat: z.string().optional(),
  mergeStrategy: z.enum(['squash', 'rebase', 'merge']).optional(),
  hooks: z.record(z.unknown()).optional(),
});

export const VaultScopeSchema = z.object({
  repo: z.string(),
  program: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Root schema
// ---------------------------------------------------------------------------

export const RepoMetadataSchema = z.object({
  // Identity (required)
  org: z.string().min(1),
  name: z.string().min(1),
  canonicalUrl: z.string().min(1),

  // Lifecycle (server-set)
  registeredAt: z.string().datetime(),
  updatedAt: z.string().datetime(),

  // Optional typed sub-schemas
  host: HostSchema.optional(),
  credential: CredentialSchema.optional(),
  workflow: WorkflowSchema.optional(),
  vaultScope: VaultScopeSchema.optional(),

  // Discovery fields
  description: z.string().optional(),
  topics: z.array(z.string()).optional(),
  language: z.string().optional(),
  defaultBranch: z.string().optional(),
  isPrivate: z.boolean().optional(),
  isFork: z.boolean().optional(),
  stars: z.number().int().nonnegative().optional(),
  lastPushedAt: z.string().datetime().optional(),

  // Escape hatch
  extra: z.record(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

/** Minimum payload to register a new repo. Server sets registeredAt/updatedAt. */
export const CreateRepoInputSchema = RepoMetadataSchema.pick({
  org: true,
  name: true,
  canonicalUrl: true,
}).merge(
  RepoMetadataSchema.omit({
    org: true,
    name: true,
    canonicalUrl: true,
    registeredAt: true,
    updatedAt: true,
  }).partial(),
);

/** Patch payload — omits identity and server-set lifecycle fields; all remaining optional. */
export const PatchRepoInputSchema = RepoMetadataSchema.omit({
  org: true,
  name: true,
  registeredAt: true,
  updatedAt: true,
}).partial();

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type Host = z.infer<typeof HostSchema>;
export type Credential = z.infer<typeof CredentialSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;
export type VaultScope = z.infer<typeof VaultScopeSchema>;
export type RepoMetadata = z.infer<typeof RepoMetadataSchema>;
export type CreateRepoInput = z.infer<typeof CreateRepoInputSchema>;
export type PatchRepoInput = z.infer<typeof PatchRepoInputSchema>;
