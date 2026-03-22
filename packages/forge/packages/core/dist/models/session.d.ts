import { z } from 'zod';
/**
 * Describes which tier of the 3-tier resolution found the repo.
 *
 *   "user"    — found in the user's repo index (scan_paths)
 *   "managed" — found in the managed pool (~/Horus/data/repos/<name>/)
 *   "cloned"  — not found; cloned fresh from remote into managed pool
 */
export declare const RepoSourceSchema: z.ZodEnum<["user", "managed", "cloned"]>;
export type RepoSource = z.infer<typeof RepoSourceSchema>;
/**
 * Snapshot of the workflow configuration used when the session was created.
 * Stored so the session record is self-contained.
 */
export declare const SessionWorkflowSchema: z.ZodObject<{
    type: z.ZodEnum<["owner", "fork", "contributor"]>;
    pushTo: z.ZodString;
    prTarget: z.ZodObject<{
        repo: z.ZodString;
        branch: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        branch: string;
        repo: string;
    }, {
        branch: string;
        repo: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "owner" | "fork" | "contributor";
    pushTo: string;
    prTarget: {
        branch: string;
        repo: string;
    };
}, {
    type: "owner" | "fork" | "contributor";
    pushTo: string;
    prTarget: {
        branch: string;
        repo: string;
    };
}>;
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
export declare const SessionRecordSchema: z.ZodObject<{
    /** Unique session identifier, e.g. "sess-ab12cd34" */
    sessionId: z.ZodString;
    /** Work item ID (Anvil note ID or slug) */
    workItem: z.ZodString;
    /** Repository name */
    repo: z.ZodString;
    /** Feature branch name */
    branch: z.ZodString;
    /** Base branch the feature was created from */
    baseBranch: z.ZodString;
    /** Absolute path to the git worktree (container-internal when running in Docker) */
    sessionPath: z.ZodString;
    /**
     * Host-side absolute path to the worktree.
     * Only differs from sessionPath when Forge runs inside Docker.
     */
    hostSessionPath: z.ZodOptional<z.ZodString>;
    /** How the repo was resolved */
    repoSource: z.ZodEnum<["user", "managed", "cloned"]>;
    /** Workflow snapshot at session creation time */
    workflow: z.ZodObject<{
        type: z.ZodEnum<["owner", "fork", "contributor"]>;
        pushTo: z.ZodString;
        prTarget: z.ZodObject<{
            repo: z.ZodString;
            branch: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            branch: string;
            repo: string;
        }, {
            branch: string;
            repo: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        type: "owner" | "fork" | "contributor";
        pushTo: string;
        prTarget: {
            branch: string;
            repo: string;
        };
    }, {
        type: "owner" | "fork" | "contributor";
        pushTo: string;
        prTarget: {
            branch: string;
            repo: string;
        };
    }>;
    /** 1-based slot number; >1 means this is a second/third agent for the same workItem */
    agentSlot: z.ZodDefault<z.ZodNumber>;
    /** ISO timestamp when the session was created */
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    branch: string;
    createdAt: string;
    repo: string;
    workflow: {
        type: "owner" | "fork" | "contributor";
        pushTo: string;
        prTarget: {
            branch: string;
            repo: string;
        };
    };
    sessionId: string;
    workItem: string;
    baseBranch: string;
    sessionPath: string;
    repoSource: "user" | "managed" | "cloned";
    agentSlot: number;
    hostSessionPath?: string | undefined;
}, {
    branch: string;
    createdAt: string;
    repo: string;
    workflow: {
        type: "owner" | "fork" | "contributor";
        pushTo: string;
        prTarget: {
            branch: string;
            repo: string;
        };
    };
    sessionId: string;
    workItem: string;
    baseBranch: string;
    sessionPath: string;
    repoSource: "user" | "managed" | "cloned";
    hostSessionPath?: string | undefined;
    agentSlot?: number | undefined;
}>;
export type SessionRecord = z.infer<typeof SessionRecordSchema>;
/**
 * Top-level sessions.json file structure.
 */
export declare const SessionStoreSchema: z.ZodObject<{
    version: z.ZodLiteral<"1">;
    sessions: z.ZodArray<z.ZodObject<{
        /** Unique session identifier, e.g. "sess-ab12cd34" */
        sessionId: z.ZodString;
        /** Work item ID (Anvil note ID or slug) */
        workItem: z.ZodString;
        /** Repository name */
        repo: z.ZodString;
        /** Feature branch name */
        branch: z.ZodString;
        /** Base branch the feature was created from */
        baseBranch: z.ZodString;
        /** Absolute path to the git worktree (container-internal when running in Docker) */
        sessionPath: z.ZodString;
        /**
         * Host-side absolute path to the worktree.
         * Only differs from sessionPath when Forge runs inside Docker.
         */
        hostSessionPath: z.ZodOptional<z.ZodString>;
        /** How the repo was resolved */
        repoSource: z.ZodEnum<["user", "managed", "cloned"]>;
        /** Workflow snapshot at session creation time */
        workflow: z.ZodObject<{
            type: z.ZodEnum<["owner", "fork", "contributor"]>;
            pushTo: z.ZodString;
            prTarget: z.ZodObject<{
                repo: z.ZodString;
                branch: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                branch: string;
                repo: string;
            }, {
                branch: string;
                repo: string;
            }>;
        }, "strip", z.ZodTypeAny, {
            type: "owner" | "fork" | "contributor";
            pushTo: string;
            prTarget: {
                branch: string;
                repo: string;
            };
        }, {
            type: "owner" | "fork" | "contributor";
            pushTo: string;
            prTarget: {
                branch: string;
                repo: string;
            };
        }>;
        /** 1-based slot number; >1 means this is a second/third agent for the same workItem */
        agentSlot: z.ZodDefault<z.ZodNumber>;
        /** ISO timestamp when the session was created */
        createdAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        branch: string;
        createdAt: string;
        repo: string;
        workflow: {
            type: "owner" | "fork" | "contributor";
            pushTo: string;
            prTarget: {
                branch: string;
                repo: string;
            };
        };
        sessionId: string;
        workItem: string;
        baseBranch: string;
        sessionPath: string;
        repoSource: "user" | "managed" | "cloned";
        agentSlot: number;
        hostSessionPath?: string | undefined;
    }, {
        branch: string;
        createdAt: string;
        repo: string;
        workflow: {
            type: "owner" | "fork" | "contributor";
            pushTo: string;
            prTarget: {
                branch: string;
                repo: string;
            };
        };
        sessionId: string;
        workItem: string;
        baseBranch: string;
        sessionPath: string;
        repoSource: "user" | "managed" | "cloned";
        hostSessionPath?: string | undefined;
        agentSlot?: number | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    version: "1";
    sessions: {
        branch: string;
        createdAt: string;
        repo: string;
        workflow: {
            type: "owner" | "fork" | "contributor";
            pushTo: string;
            prTarget: {
                branch: string;
                repo: string;
            };
        };
        sessionId: string;
        workItem: string;
        baseBranch: string;
        sessionPath: string;
        repoSource: "user" | "managed" | "cloned";
        agentSlot: number;
        hostSessionPath?: string | undefined;
    }[];
}, {
    version: "1";
    sessions: {
        branch: string;
        createdAt: string;
        repo: string;
        workflow: {
            type: "owner" | "fork" | "contributor";
            pushTo: string;
            prTarget: {
                branch: string;
                repo: string;
            };
        };
        sessionId: string;
        workItem: string;
        baseBranch: string;
        sessionPath: string;
        repoSource: "user" | "managed" | "cloned";
        hostSessionPath?: string | undefined;
        agentSlot?: number | undefined;
    }[];
}>;
export type SessionStore = z.infer<typeof SessionStoreSchema>;
//# sourceMappingURL=session.d.ts.map