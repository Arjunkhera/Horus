"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RepoWorkflowSchema = exports.WorkflowStrategySchema = void 0;
const zod_1 = require("zod");
exports.WorkflowStrategySchema = zod_1.z.enum(['owner', 'fork', 'direct']);
/**
 * Resolved workflow information for a repository.
 *
 * Produced by ForgeCore.repoWorkflow() using a three-tier resolution:
 *   1. Vault repo profile  (shared, team-wide)
 *   2. Auto-detect         (from local git remotes)
 *   3. Default fallback    (direct / main)
 */
exports.RepoWorkflowSchema = zod_1.z.object({
    repoName: zod_1.z.string(),
    hosting: zod_1.z.object({
        hostname: zod_1.z.string(), // e.g. github.com or github.corp.acme.com
        org: zod_1.z.string(), // org or owner on that host
    }),
    workflow: zod_1.z.object({
        strategy: exports.WorkflowStrategySchema,
        defaultBranch: zod_1.z.string(),
        prTarget: zod_1.z.string(),
        branchConvention: zod_1.z.string().optional(),
    }),
    /** Which resolution tier produced this result. */
    source: zod_1.z.enum(['vault', 'auto-detect', 'default']),
});
//# sourceMappingURL=repo-workflow.js.map