import { z } from 'zod';

export const WorkflowStrategySchema = z.enum(['owner', 'fork', 'direct']);
export type WorkflowStrategy = z.infer<typeof WorkflowStrategySchema>;

/**
 * Resolved workflow information for a repository.
 *
 * Produced by ForgeCore.repoWorkflow() using a three-tier resolution:
 *   1. Vault repo profile  (shared, team-wide)
 *   2. Auto-detect         (from local git remotes)
 *   3. Default fallback    (direct / main)
 */
export const RepoWorkflowSchema = z.object({
  repoName: z.string(),
  hosting: z.object({
    hostname: z.string(),  // e.g. github.com or github.corp.acme.com
    org: z.string(),       // org or owner on that host
  }),
  workflow: z.object({
    strategy: WorkflowStrategySchema,
    defaultBranch: z.string(),
    prTarget: z.string(),
    branchConvention: z.string().optional(),
  }),
  /** Which resolution tier produced this result. */
  source: z.enum(['vault', 'auto-detect', 'default']),
});

export type RepoWorkflow = z.infer<typeof RepoWorkflowSchema>;
