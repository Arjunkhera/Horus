"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RepoIndexSchema = exports.RepoIndexEntrySchema = exports.RepoIndexWorkflowSchema = void 0;
const zod_1 = require("zod");
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
exports.RepoIndexWorkflowSchema = zod_1.z.object({
    /** Workflow type: owner = full commit access, fork = PR from fork, contributor = PR from branch */
    type: zod_1.z.enum(['owner', 'fork', 'contributor']),
    /** Upstream remote URL (fork workflow only) */
    upstream: zod_1.z.string().optional(),
    /** Fork remote URL (fork workflow only) */
    fork: zod_1.z.string().optional(),
    /** Which remote to push feature branches to (usually "origin") */
    pushTo: zod_1.z.string(),
    /** Where to target PRs */
    prTarget: zod_1.z.object({
        /** Org/repo slug, e.g. "SomeOrg/SomeProject" */
        repo: zod_1.z.string(),
        /** Target branch, e.g. "main" */
        branch: zod_1.z.string(),
    }),
    /** Branch naming convention, e.g. "{type}/{id}-{slug}" */
    branchPattern: zod_1.z.string().optional(),
    /** Commit message format, e.g. "conventional" */
    commitFormat: zod_1.z.string().optional(),
    /** ISO timestamp when workflow was confirmed */
    confirmedAt: zod_1.z.string(),
    /** How the workflow was confirmed */
    confirmedBy: zod_1.z.enum(['user', 'auto']),
    /**
     * Snapshot of remotes at confirmation time, used for staleness detection.
     * Key = remote name, value = fetch URL.
     */
    remotesSnapshot: zod_1.z.record(zod_1.z.string(), zod_1.z.string()).optional(),
});
exports.RepoIndexEntrySchema = zod_1.z.object({
    name: zod_1.z.string(),
    localPath: zod_1.z.string(),
    remoteUrl: zod_1.z.string().nullable(),
    defaultBranch: zod_1.z.string(),
    language: zod_1.z.string().nullable(),
    framework: zod_1.z.string().nullable(),
    lastCommitDate: zod_1.z.string(), // ISO date string
    lastScannedAt: zod_1.z.string(), // ISO date string
    /** Confirmed workflow metadata (optional — absent until user confirms) */
    workflow: exports.RepoIndexWorkflowSchema.optional(),
});
exports.RepoIndexSchema = zod_1.z.object({
    version: zod_1.z.literal('1'),
    scannedAt: zod_1.z.string(),
    scanPaths: zod_1.z.array(zod_1.z.string()),
    repos: zod_1.z.array(exports.RepoIndexEntrySchema),
});
//# sourceMappingURL=repo-index.js.map