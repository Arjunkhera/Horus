import type { RepoIndexEntry } from '../models/repo-index.js';
import type { SessionWorkflow, RepoSource } from '../models/session.js';
import type { GlobalConfig } from '../models/global-config.js';
/**
 * Inline workflow parameter — used when the client provides workflow info
 * directly (non-Claude-Code clients, first-time confirmation).
 */
export interface WorkflowInput {
    type: 'owner' | 'fork' | 'contributor';
    upstream?: string;
    fork?: string;
    pushTo: string;
    prTarget: {
        repo: string;
        branch: string;
    };
    branchPattern?: string;
    commitFormat?: string;
}
export interface RepoDevelopOptions {
    /** Repository name (looked up in repo index) */
    repo: string;
    /** Work item ID or slug — used to namespace the session path */
    workItem: string;
    /** Optional branch name. Auto-generated from workItem if omitted. */
    branch?: string;
    /**
     * Inline workflow — saves to repo metadata and proceeds.
     * If omitted AND repo has no saved workflow, returns needs_workflow_confirmation.
     */
    workflow?: WorkflowInput;
}
/** Session created or resumed successfully */
export interface RepoDevelopResult {
    status: 'created' | 'resumed';
    sessionId: string;
    sessionPath: string;
    hostSessionPath?: string;
    branch: string;
    baseBranch: string;
    repo: string;
    repoSource: RepoSource;
    workflow: SessionWorkflow;
    agentSlot: number;
}
/** Workflow not yet confirmed for this repo */
export interface RepoDevelopNeedsConfirmation {
    status: 'needs_workflow_confirmation';
    detected: {
        type: 'owner' | 'fork' | 'contributor';
        upstream?: string;
        fork?: string;
        pushTo: string;
        prTarget: {
            repo: string;
            branch: string;
        };
    };
    message: string;
}
export type RepoDevelopResponse = RepoDevelopResult | RepoDevelopNeedsConfirmation;
/**
 * Core logic for `forge_develop`:
 *
 * 1. Resolve the repo via 3-tier lookup
 * 2. Check for existing session → resume if found
 * 3. Verify workflow is confirmed (or accept inline workflow input)
 * 4. git fetch + worktree creation
 * 5. Install placeholder hooks
 * 6. Save session record
 */
export declare function repoDevelop(opts: RepoDevelopOptions, globalConfig: GlobalConfig, repoIndex: {
    repos: RepoIndexEntry[];
} | null, saveRepoIndexFn: (repos: RepoIndexEntry[]) => Promise<void>): Promise<RepoDevelopResponse>;
//# sourceMappingURL=repo-develop.d.ts.map