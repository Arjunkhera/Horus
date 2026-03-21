import type { ForgeCore } from '../core.js';
import type { WorkspaceRecord } from '../models/index.js';
/**
 * Options for creating a new workspace.
 */
export interface WorkspaceCreateOptions {
    configName: string;
    configVersion?: string;
    storyId?: string;
    storyTitle?: string;
    repos?: string[];
    mountPath?: string;
}
/**
 * Custom error type for workspace creation failures.
 */
export declare class WorkspaceCreateError extends Error {
    readonly suggestion?: string | undefined;
    constructor(message: string, suggestion?: string | undefined);
}
/**
 * Helper: Convert text to lowercase kebab-case, max 30 chars.
 */
export declare function slugify(text: string): string;
/**
 * Helper: Generate branch name from pattern, replacing {subtype}, {id}, {slug}.
 */
export declare function generateBranchName(pattern: string, vars: {
    subtype?: string;
    id?: string;
    slug?: string;
}): string;
/**
 * Main workspace creator class.
 */
export declare class WorkspaceCreator {
    private readonly forge;
    constructor(forge: ForgeCore);
    create(options: WorkspaceCreateOptions): Promise<WorkspaceRecord>;
}
//# sourceMappingURL=workspace-creator.d.ts.map