export interface RepoCloneOptions {
    localPath: string;
    remoteUrl: string | null;
    destPath: string;
    branchName?: string;
    defaultBranch: string;
}
export interface RepoCloneResult {
    repoName: string;
    clonePath: string;
    hostClonePath: string;
    branch: string;
    origin: string;
}
export interface CreateReferenceCloneResult {
    actualDefaultBranch: string;
}
export declare class RepoCloneError extends Error {
    readonly suggestion?: string | undefined;
    constructor(message: string, suggestion?: string | undefined);
}
/**
 * Create an isolated reference clone of a repository.
 *
 * Uses `git clone --reference <localPath>` to reuse local objects for speed
 * while fetching from remoteUrl for freshness. Falls back to a plain local
 * clone when remoteUrl is null or unreachable (e.g. Docker without SSH).
 *
 * When branchName is provided, creates and checks out that branch.
 * When omitted, the clone stays on the default branch.
 *
 * Returns the actual default branch detected from the clone (which may differ
 * from opts.defaultBranch if the index entry is stale, e.g. 'master' vs 'main').
 */
export declare function createReferenceClone(opts: RepoCloneOptions): Promise<CreateReferenceCloneResult>;
//# sourceMappingURL=repo-clone.d.ts.map