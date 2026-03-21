import { z } from 'zod';
export declare const WorkflowStrategySchema: z.ZodEnum<["owner", "fork", "direct"]>;
export type WorkflowStrategy = z.infer<typeof WorkflowStrategySchema>;
/**
 * Resolved workflow information for a repository.
 *
 * Produced by ForgeCore.repoWorkflow() using a three-tier resolution:
 *   1. Vault repo profile  (shared, team-wide)
 *   2. Auto-detect         (from local git remotes)
 *   3. Default fallback    (direct / main)
 */
export declare const RepoWorkflowSchema: z.ZodObject<{
    repoName: z.ZodString;
    hosting: z.ZodObject<{
        hostname: z.ZodString;
        org: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        hostname: string;
        org: string;
    }, {
        hostname: string;
        org: string;
    }>;
    workflow: z.ZodObject<{
        strategy: z.ZodEnum<["owner", "fork", "direct"]>;
        defaultBranch: z.ZodString;
        prTarget: z.ZodString;
        branchConvention: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        defaultBranch: string;
        strategy: "owner" | "fork" | "direct";
        prTarget: string;
        branchConvention?: string | undefined;
    }, {
        defaultBranch: string;
        strategy: "owner" | "fork" | "direct";
        prTarget: string;
        branchConvention?: string | undefined;
    }>;
    /** Which resolution tier produced this result. */
    source: z.ZodEnum<["vault", "auto-detect", "default"]>;
}, "strip", z.ZodTypeAny, {
    repoName: string;
    hosting: {
        hostname: string;
        org: string;
    };
    workflow: {
        defaultBranch: string;
        strategy: "owner" | "fork" | "direct";
        prTarget: string;
        branchConvention?: string | undefined;
    };
    source: "vault" | "auto-detect" | "default";
}, {
    repoName: string;
    hosting: {
        hostname: string;
        org: string;
    };
    workflow: {
        defaultBranch: string;
        strategy: "owner" | "fork" | "direct";
        prTarget: string;
        branchConvention?: string | undefined;
    };
    source: "vault" | "auto-detect" | "default";
}>;
export type RepoWorkflow = z.infer<typeof RepoWorkflowSchema>;
//# sourceMappingURL=repo-workflow.d.ts.map