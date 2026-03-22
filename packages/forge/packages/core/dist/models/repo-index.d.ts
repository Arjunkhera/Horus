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
export declare const RepoIndexWorkflowSchema: z.ZodObject<{
    /** Workflow type: owner = full commit access, fork = PR from fork, contributor = PR from branch */
    type: z.ZodEnum<["owner", "fork", "contributor"]>;
    /** Upstream remote URL (fork workflow only) */
    upstream: z.ZodOptional<z.ZodString>;
    /** Fork remote URL (fork workflow only) */
    fork: z.ZodOptional<z.ZodString>;
    /** Which remote to push feature branches to (usually "origin") */
    pushTo: z.ZodString;
    /** Where to target PRs */
    prTarget: z.ZodObject<{
        /** Org/repo slug, e.g. "SomeOrg/SomeProject" */
        repo: z.ZodString;
        /** Target branch, e.g. "main" */
        branch: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        branch: string;
        repo: string;
    }, {
        branch: string;
        repo: string;
    }>;
    /** Branch naming convention, e.g. "{type}/{id}-{slug}" */
    branchPattern: z.ZodOptional<z.ZodString>;
    /** Commit message format, e.g. "conventional" */
    commitFormat: z.ZodOptional<z.ZodString>;
    /** ISO timestamp when workflow was confirmed */
    confirmedAt: z.ZodString;
    /** How the workflow was confirmed */
    confirmedBy: z.ZodEnum<["user", "auto"]>;
    /**
     * Snapshot of remotes at confirmation time, used for staleness detection.
     * Key = remote name, value = fetch URL.
     */
    remotesSnapshot: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    type: "owner" | "fork" | "contributor";
    pushTo: string;
    prTarget: {
        branch: string;
        repo: string;
    };
    confirmedAt: string;
    confirmedBy: "user" | "auto";
    fork?: string | undefined;
    upstream?: string | undefined;
    branchPattern?: string | undefined;
    commitFormat?: string | undefined;
    remotesSnapshot?: Record<string, string> | undefined;
}, {
    type: "owner" | "fork" | "contributor";
    pushTo: string;
    prTarget: {
        branch: string;
        repo: string;
    };
    confirmedAt: string;
    confirmedBy: "user" | "auto";
    fork?: string | undefined;
    upstream?: string | undefined;
    branchPattern?: string | undefined;
    commitFormat?: string | undefined;
    remotesSnapshot?: Record<string, string> | undefined;
}>;
export type RepoIndexWorkflow = z.infer<typeof RepoIndexWorkflowSchema>;
export declare const RepoIndexEntrySchema: z.ZodObject<{
    name: z.ZodString;
    localPath: z.ZodString;
    remoteUrl: z.ZodNullable<z.ZodString>;
    defaultBranch: z.ZodString;
    language: z.ZodNullable<z.ZodString>;
    framework: z.ZodNullable<z.ZodString>;
    lastCommitDate: z.ZodString;
    lastScannedAt: z.ZodString;
    /** Confirmed workflow metadata (optional — absent until user confirms) */
    workflow: z.ZodOptional<z.ZodObject<{
        /** Workflow type: owner = full commit access, fork = PR from fork, contributor = PR from branch */
        type: z.ZodEnum<["owner", "fork", "contributor"]>;
        /** Upstream remote URL (fork workflow only) */
        upstream: z.ZodOptional<z.ZodString>;
        /** Fork remote URL (fork workflow only) */
        fork: z.ZodOptional<z.ZodString>;
        /** Which remote to push feature branches to (usually "origin") */
        pushTo: z.ZodString;
        /** Where to target PRs */
        prTarget: z.ZodObject<{
            /** Org/repo slug, e.g. "SomeOrg/SomeProject" */
            repo: z.ZodString;
            /** Target branch, e.g. "main" */
            branch: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            branch: string;
            repo: string;
        }, {
            branch: string;
            repo: string;
        }>;
        /** Branch naming convention, e.g. "{type}/{id}-{slug}" */
        branchPattern: z.ZodOptional<z.ZodString>;
        /** Commit message format, e.g. "conventional" */
        commitFormat: z.ZodOptional<z.ZodString>;
        /** ISO timestamp when workflow was confirmed */
        confirmedAt: z.ZodString;
        /** How the workflow was confirmed */
        confirmedBy: z.ZodEnum<["user", "auto"]>;
        /**
         * Snapshot of remotes at confirmation time, used for staleness detection.
         * Key = remote name, value = fetch URL.
         */
        remotesSnapshot: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        type: "owner" | "fork" | "contributor";
        pushTo: string;
        prTarget: {
            branch: string;
            repo: string;
        };
        confirmedAt: string;
        confirmedBy: "user" | "auto";
        fork?: string | undefined;
        upstream?: string | undefined;
        branchPattern?: string | undefined;
        commitFormat?: string | undefined;
        remotesSnapshot?: Record<string, string> | undefined;
    }, {
        type: "owner" | "fork" | "contributor";
        pushTo: string;
        prTarget: {
            branch: string;
            repo: string;
        };
        confirmedAt: string;
        confirmedBy: "user" | "auto";
        fork?: string | undefined;
        upstream?: string | undefined;
        branchPattern?: string | undefined;
        commitFormat?: string | undefined;
        remotesSnapshot?: Record<string, string> | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    localPath: string;
    remoteUrl: string | null;
    defaultBranch: string;
    language: string | null;
    framework: string | null;
    lastCommitDate: string;
    lastScannedAt: string;
    workflow?: {
        type: "owner" | "fork" | "contributor";
        pushTo: string;
        prTarget: {
            branch: string;
            repo: string;
        };
        confirmedAt: string;
        confirmedBy: "user" | "auto";
        fork?: string | undefined;
        upstream?: string | undefined;
        branchPattern?: string | undefined;
        commitFormat?: string | undefined;
        remotesSnapshot?: Record<string, string> | undefined;
    } | undefined;
}, {
    name: string;
    localPath: string;
    remoteUrl: string | null;
    defaultBranch: string;
    language: string | null;
    framework: string | null;
    lastCommitDate: string;
    lastScannedAt: string;
    workflow?: {
        type: "owner" | "fork" | "contributor";
        pushTo: string;
        prTarget: {
            branch: string;
            repo: string;
        };
        confirmedAt: string;
        confirmedBy: "user" | "auto";
        fork?: string | undefined;
        upstream?: string | undefined;
        branchPattern?: string | undefined;
        commitFormat?: string | undefined;
        remotesSnapshot?: Record<string, string> | undefined;
    } | undefined;
}>;
export declare const RepoIndexSchema: z.ZodObject<{
    version: z.ZodLiteral<"1">;
    scannedAt: z.ZodString;
    scanPaths: z.ZodArray<z.ZodString, "many">;
    repos: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        localPath: z.ZodString;
        remoteUrl: z.ZodNullable<z.ZodString>;
        defaultBranch: z.ZodString;
        language: z.ZodNullable<z.ZodString>;
        framework: z.ZodNullable<z.ZodString>;
        lastCommitDate: z.ZodString;
        lastScannedAt: z.ZodString;
        /** Confirmed workflow metadata (optional — absent until user confirms) */
        workflow: z.ZodOptional<z.ZodObject<{
            /** Workflow type: owner = full commit access, fork = PR from fork, contributor = PR from branch */
            type: z.ZodEnum<["owner", "fork", "contributor"]>;
            /** Upstream remote URL (fork workflow only) */
            upstream: z.ZodOptional<z.ZodString>;
            /** Fork remote URL (fork workflow only) */
            fork: z.ZodOptional<z.ZodString>;
            /** Which remote to push feature branches to (usually "origin") */
            pushTo: z.ZodString;
            /** Where to target PRs */
            prTarget: z.ZodObject<{
                /** Org/repo slug, e.g. "SomeOrg/SomeProject" */
                repo: z.ZodString;
                /** Target branch, e.g. "main" */
                branch: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                branch: string;
                repo: string;
            }, {
                branch: string;
                repo: string;
            }>;
            /** Branch naming convention, e.g. "{type}/{id}-{slug}" */
            branchPattern: z.ZodOptional<z.ZodString>;
            /** Commit message format, e.g. "conventional" */
            commitFormat: z.ZodOptional<z.ZodString>;
            /** ISO timestamp when workflow was confirmed */
            confirmedAt: z.ZodString;
            /** How the workflow was confirmed */
            confirmedBy: z.ZodEnum<["user", "auto"]>;
            /**
             * Snapshot of remotes at confirmation time, used for staleness detection.
             * Key = remote name, value = fetch URL.
             */
            remotesSnapshot: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            type: "owner" | "fork" | "contributor";
            pushTo: string;
            prTarget: {
                branch: string;
                repo: string;
            };
            confirmedAt: string;
            confirmedBy: "user" | "auto";
            fork?: string | undefined;
            upstream?: string | undefined;
            branchPattern?: string | undefined;
            commitFormat?: string | undefined;
            remotesSnapshot?: Record<string, string> | undefined;
        }, {
            type: "owner" | "fork" | "contributor";
            pushTo: string;
            prTarget: {
                branch: string;
                repo: string;
            };
            confirmedAt: string;
            confirmedBy: "user" | "auto";
            fork?: string | undefined;
            upstream?: string | undefined;
            branchPattern?: string | undefined;
            commitFormat?: string | undefined;
            remotesSnapshot?: Record<string, string> | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        localPath: string;
        remoteUrl: string | null;
        defaultBranch: string;
        language: string | null;
        framework: string | null;
        lastCommitDate: string;
        lastScannedAt: string;
        workflow?: {
            type: "owner" | "fork" | "contributor";
            pushTo: string;
            prTarget: {
                branch: string;
                repo: string;
            };
            confirmedAt: string;
            confirmedBy: "user" | "auto";
            fork?: string | undefined;
            upstream?: string | undefined;
            branchPattern?: string | undefined;
            commitFormat?: string | undefined;
            remotesSnapshot?: Record<string, string> | undefined;
        } | undefined;
    }, {
        name: string;
        localPath: string;
        remoteUrl: string | null;
        defaultBranch: string;
        language: string | null;
        framework: string | null;
        lastCommitDate: string;
        lastScannedAt: string;
        workflow?: {
            type: "owner" | "fork" | "contributor";
            pushTo: string;
            prTarget: {
                branch: string;
                repo: string;
            };
            confirmedAt: string;
            confirmedBy: "user" | "auto";
            fork?: string | undefined;
            upstream?: string | undefined;
            branchPattern?: string | undefined;
            commitFormat?: string | undefined;
            remotesSnapshot?: Record<string, string> | undefined;
        } | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    version: "1";
    repos: {
        name: string;
        localPath: string;
        remoteUrl: string | null;
        defaultBranch: string;
        language: string | null;
        framework: string | null;
        lastCommitDate: string;
        lastScannedAt: string;
        workflow?: {
            type: "owner" | "fork" | "contributor";
            pushTo: string;
            prTarget: {
                branch: string;
                repo: string;
            };
            confirmedAt: string;
            confirmedBy: "user" | "auto";
            fork?: string | undefined;
            upstream?: string | undefined;
            branchPattern?: string | undefined;
            commitFormat?: string | undefined;
            remotesSnapshot?: Record<string, string> | undefined;
        } | undefined;
    }[];
    scannedAt: string;
    scanPaths: string[];
}, {
    version: "1";
    repos: {
        name: string;
        localPath: string;
        remoteUrl: string | null;
        defaultBranch: string;
        language: string | null;
        framework: string | null;
        lastCommitDate: string;
        lastScannedAt: string;
        workflow?: {
            type: "owner" | "fork" | "contributor";
            pushTo: string;
            prTarget: {
                branch: string;
                repo: string;
            };
            confirmedAt: string;
            confirmedBy: "user" | "auto";
            fork?: string | undefined;
            upstream?: string | undefined;
            branchPattern?: string | undefined;
            commitFormat?: string | undefined;
            remotesSnapshot?: Record<string, string> | undefined;
        } | undefined;
    }[];
    scannedAt: string;
    scanPaths: string[];
}>;
export type RepoIndexEntry = z.infer<typeof RepoIndexEntrySchema>;
export type RepoIndex = z.infer<typeof RepoIndexSchema>;
//# sourceMappingURL=repo-index.d.ts.map