import { z } from 'zod';

/**
 * Persisted workflow metadata stored in the repo index entry.
 *
 * This is distinct from RepoWorkflow (the resolver response type).
 * RepoIndexWorkflow represents what the user has confirmed and saved
 * to repos.json, so it can be used without re-running detection.
 *
 * confirmedBy: "user" = explicitly confirmed via forge_develop workflow confirmation flow
 * confirmedBy: "auto" = saved after auto-detection without explicit user confirmation
 */
export const RepoIndexWorkflowSchema = z.object({
  /** Workflow type: owner = full commit access, fork = PR from fork, contributor = PR from branch */
  type: z.enum(['owner', 'fork', 'contributor']),
  /** Upstream remote URL (fork workflow only) */
  upstream: z.string().optional(),
  /** Fork remote URL (fork workflow only) */
  fork: z.string().optional(),
  /** Which remote to push feature branches to (usually "origin") */
  pushTo: z.string(),
  /** Where to target PRs */
  prTarget: z.object({
    /** Org/repo slug, e.g. "SomeOrg/SomeProject" */
    repo: z.string(),
    /** Target branch, e.g. "main" */
    branch: z.string(),
  }),
  /** Branch naming convention, e.g. "{type}/{id}-{slug}" */
  branchPattern: z.string().optional(),
  /** Commit message format, e.g. "conventional" */
  commitFormat: z.string().optional(),
  /** ISO timestamp when workflow was confirmed */
  confirmedAt: z.string(),
  /** How the workflow was confirmed */
  confirmedBy: z.enum(['user', 'auto']),
  /**
   * Snapshot of remotes at confirmation time, used for staleness detection.
   * Key = remote name, value = fetch URL.
   */
  remotesSnapshot: z.record(z.string(), z.string()).optional(),
});

export type RepoIndexWorkflow = z.infer<typeof RepoIndexWorkflowSchema>;

export const RepoIndexEntrySchema = z.object({
  name: z.string(),
  localPath: z.string(),
  remoteUrl: z.string().nullable(),
  defaultBranch: z.string(),
  language: z.string().nullable(),
  framework: z.string().nullable(),
  lastCommitDate: z.string(),   // ISO date string
  lastScannedAt: z.string(),    // ISO date string
  /** Confirmed workflow metadata (optional — absent until user confirms) */
  workflow: RepoIndexWorkflowSchema.optional(),
  /**
   * The remote name to fetch from and use as the worktree base branch.
   * e.g. "origin", "upstream". Set explicitly to avoid ambiguity when
   * multiple remotes are configured (e.g. team forks for code review).
   * Populated via forge_develop resolution chain: registry → Vault → user prompt.
   */
  default_remote: z.string().optional(),
});

export const RepoIndexSchema = z.object({
  version: z.literal('1'),
  scannedAt: z.string(),
  scanPaths: z.array(z.string()),
  repos: z.array(RepoIndexEntrySchema),
});

export type RepoIndexEntry = z.infer<typeof RepoIndexEntrySchema>;
export type RepoIndex = z.infer<typeof RepoIndexSchema>;
