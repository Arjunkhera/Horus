import { z } from 'zod';

/**
 * Describes which tier of the 3-tier resolution found the repo.
 *
 *   "user"    — found in the user's repo index (scan_paths)
 *   "managed" — found in the managed pool (~/Horus/data/repos/<name>/)
 *   "cloned"  — not found; cloned fresh from remote into managed pool
 */
export const RepoSourceSchema = z.enum(['user', 'managed', 'cloned']);
export type RepoSource = z.infer<typeof RepoSourceSchema>;

/**
 * Snapshot of the workflow configuration used when the session was created.
 * Stored so the session record is self-contained.
 */
export const SessionWorkflowSchema = z.object({
  type: z.enum(['owner', 'fork', 'contributor']),
  pushTo: z.string(),
  prTarget: z.object({
    repo: z.string(),
    branch: z.string(),
  }),
});

export type SessionWorkflow = z.infer<typeof SessionWorkflowSchema>;

/**
 * A single code session record stored in sessions.json.
 *
 * A session = one agent working on one work item in one repo,
 * with its own git worktree at sessionPath.
 *
 * Multiple agents can work on the same workItem — each gets a separate slot
 * (agentSlot = 1, 2, 3...) with a unique sessionPath suffix ("-2", "-3"…).
 */
export const SessionRecordSchema = z.object({
  /** Unique session identifier, e.g. "sess-ab12cd34" */
  sessionId: z.string(),
  /** Work item ID (Anvil note ID or slug) */
  workItem: z.string(),
  /** Repository name */
  repo: z.string(),
  /** Feature branch name */
  branch: z.string(),
  /** Base branch the feature was created from */
  baseBranch: z.string(),
  /** Absolute path to the git worktree (container-internal when running in Docker) */
  sessionPath: z.string(),
  /**
   * Host-side absolute path to the worktree.
   * Only differs from sessionPath when Forge runs inside Docker.
   */
  hostSessionPath: z.string().optional(),
  /** How the repo was resolved */
  repoSource: RepoSourceSchema,
  /** Workflow snapshot at session creation time */
  workflow: SessionWorkflowSchema,
  /** 1-based slot number; >1 means this is a second/third agent for the same workItem */
  agentSlot: z.number().int().min(1).default(1),
  /** ISO timestamp when the session was created */
  createdAt: z.string(),
  /**
   * ISO timestamp of the last significant activity in this session
   * (updated on resume; used by cleanup age threshold).
   * Defaults to createdAt when not present (backward-compatible).
   */
  lastModified: z.string().optional(),
});

export type SessionRecord = z.infer<typeof SessionRecordSchema>;

/**
 * Top-level sessions.json file structure.
 */
export const SessionStoreSchema = z.object({
  version: z.literal('1'),
  sessions: z.array(SessionRecordSchema),
});

export type SessionStore = z.infer<typeof SessionStoreSchema>;
