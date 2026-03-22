"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionStoreSchema = exports.SessionRecordSchema = exports.SessionWorkflowSchema = exports.RepoSourceSchema = void 0;
const zod_1 = require("zod");
/**
 * Describes which tier of the 3-tier resolution found the repo.
 *
 *   "user"    — found in the user's repo index (scan_paths)
 *   "managed" — found in the managed pool (~/Horus/data/repos/<name>/)
 *   "cloned"  — not found; cloned fresh from remote into managed pool
 */
exports.RepoSourceSchema = zod_1.z.enum(['user', 'managed', 'cloned']);
/**
 * Snapshot of the workflow configuration used when the session was created.
 * Stored so the session record is self-contained.
 */
exports.SessionWorkflowSchema = zod_1.z.object({
    type: zod_1.z.enum(['owner', 'fork', 'contributor']),
    pushTo: zod_1.z.string(),
    prTarget: zod_1.z.object({
        repo: zod_1.z.string(),
        branch: zod_1.z.string(),
    }),
});
/**
 * A single code session record stored in sessions.json.
 *
 * A session = one agent working on one work item in one repo,
 * with its own git worktree at sessionPath.
 *
 * Multiple agents can work on the same workItem — each gets a separate slot
 * (agentSlot = 1, 2, 3...) with a unique sessionPath suffix ("-2", "-3"…).
 */
exports.SessionRecordSchema = zod_1.z.object({
    /** Unique session identifier, e.g. "sess-ab12cd34" */
    sessionId: zod_1.z.string(),
    /** Work item ID (Anvil note ID or slug) */
    workItem: zod_1.z.string(),
    /** Repository name */
    repo: zod_1.z.string(),
    /** Feature branch name */
    branch: zod_1.z.string(),
    /** Base branch the feature was created from */
    baseBranch: zod_1.z.string(),
    /** Absolute path to the git worktree (container-internal when running in Docker) */
    sessionPath: zod_1.z.string(),
    /**
     * Host-side absolute path to the worktree.
     * Only differs from sessionPath when Forge runs inside Docker.
     */
    hostSessionPath: zod_1.z.string().optional(),
    /** How the repo was resolved */
    repoSource: exports.RepoSourceSchema,
    /** Workflow snapshot at session creation time */
    workflow: exports.SessionWorkflowSchema,
    /** 1-based slot number; >1 means this is a second/third agent for the same workItem */
    agentSlot: zod_1.z.number().int().min(1).default(1),
    /** ISO timestamp when the session was created */
    createdAt: zod_1.z.string(),
});
/**
 * Top-level sessions.json file structure.
 */
exports.SessionStoreSchema = zod_1.z.object({
    version: zod_1.z.literal('1'),
    sessions: zod_1.z.array(exports.SessionRecordSchema),
});
//# sourceMappingURL=session.js.map