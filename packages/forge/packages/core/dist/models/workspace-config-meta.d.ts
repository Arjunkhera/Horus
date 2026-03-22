import { z } from 'zod';
declare const McpServerConfigSchema: z.ZodObject<{
    description: z.ZodString;
    required: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    description: string;
    required: boolean;
}, {
    description: string;
    required?: boolean | undefined;
}>;
declare const GitWorkflowConfigSchema: z.ZodObject<{
    branch_pattern: z.ZodDefault<z.ZodString>;
    base_branch: z.ZodDefault<z.ZodString>;
    stash_before_checkout: z.ZodDefault<z.ZodBoolean>;
    commit_format: z.ZodDefault<z.ZodEnum<["conventional", "freeform"]>>;
    pr_template: z.ZodDefault<z.ZodBoolean>;
    signed_commits: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    branch_pattern: string;
    base_branch: string;
    stash_before_checkout: boolean;
    commit_format: "conventional" | "freeform";
    pr_template: boolean;
    signed_commits: boolean;
}, {
    branch_pattern?: string | undefined;
    base_branch?: string | undefined;
    stash_before_checkout?: boolean | undefined;
    commit_format?: "conventional" | "freeform" | undefined;
    pr_template?: boolean | undefined;
    signed_commits?: boolean | undefined;
}>;
declare const WorkspaceSettingsConfigSchema: z.ZodObject<{
    retention_days: z.ZodOptional<z.ZodNumber>;
    naming_convention: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    retention_days?: number | undefined;
    naming_convention?: string | undefined;
}, {
    retention_days?: number | undefined;
    naming_convention?: string | undefined;
}>;
/**
 * Schema for workspace-config metadata.yaml — describes a Forge workspace configuration artifact.
 * @example
 * const meta = WorkspaceConfigMetaSchema.parse({
 *   id: 'sdlc-default',
 *   name: 'Default SDLC Workspace Config',
 *   version: '1.0.0',
 *   description: 'Standard workspace configuration for SDLC workflows',
 *   type: 'workspace-config',
 *   plugins: ['anvil-sdlc-v2'],
 *   skills: ['developer', 'tester']
 * });
 */
export declare const WorkspaceConfigMetaSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    version: z.ZodString;
    description: z.ZodString;
    type: z.ZodLiteral<"workspace-config">;
    author: z.ZodOptional<z.ZodString>;
    license: z.ZodOptional<z.ZodString>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    plugins: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    skills: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    mcp_servers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        description: z.ZodString;
        required: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        description: string;
        required: boolean;
    }, {
        description: string;
        required?: boolean | undefined;
    }>>>;
    settings: z.ZodDefault<z.ZodObject<{
        retention_days: z.ZodOptional<z.ZodNumber>;
        naming_convention: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        retention_days?: number | undefined;
        naming_convention?: string | undefined;
    }, {
        retention_days?: number | undefined;
        naming_convention?: string | undefined;
    }>>;
    git_workflow: z.ZodDefault<z.ZodObject<{
        branch_pattern: z.ZodDefault<z.ZodString>;
        base_branch: z.ZodDefault<z.ZodString>;
        stash_before_checkout: z.ZodDefault<z.ZodBoolean>;
        commit_format: z.ZodDefault<z.ZodEnum<["conventional", "freeform"]>>;
        pr_template: z.ZodDefault<z.ZodBoolean>;
        signed_commits: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        branch_pattern: string;
        base_branch: string;
        stash_before_checkout: boolean;
        commit_format: "conventional" | "freeform";
        pr_template: boolean;
        signed_commits: boolean;
    }, {
        branch_pattern?: string | undefined;
        base_branch?: string | undefined;
        stash_before_checkout?: boolean | undefined;
        commit_format?: "conventional" | "freeform" | undefined;
        pr_template?: boolean | undefined;
        signed_commits?: boolean | undefined;
    }>>;
    claude_permissions: z.ZodOptional<z.ZodObject<{
        allow: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        deny: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        defaultMode: z.ZodOptional<z.ZodEnum<["default", "allowedTools", "autoEdit", "bypassPermissions", "plan"]>>;
    }, "strip", z.ZodTypeAny, {
        allow: string[];
        deny: string[];
        defaultMode?: "default" | "allowedTools" | "autoEdit" | "bypassPermissions" | "plan" | undefined;
    }, {
        allow?: string[] | undefined;
        deny?: string[] | undefined;
        defaultMode?: "default" | "allowedTools" | "autoEdit" | "bypassPermissions" | "plan" | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    version: string;
    description: string;
    type: "workspace-config";
    tags: string[];
    skills: string[];
    plugins: string[];
    mcp_servers: Record<string, {
        description: string;
        required: boolean;
    }>;
    settings: {
        retention_days?: number | undefined;
        naming_convention?: string | undefined;
    };
    git_workflow: {
        branch_pattern: string;
        base_branch: string;
        stash_before_checkout: boolean;
        commit_format: "conventional" | "freeform";
        pr_template: boolean;
        signed_commits: boolean;
    };
    author?: string | undefined;
    license?: string | undefined;
    claude_permissions?: {
        allow: string[];
        deny: string[];
        defaultMode?: "default" | "allowedTools" | "autoEdit" | "bypassPermissions" | "plan" | undefined;
    } | undefined;
}, {
    id: string;
    name: string;
    version: string;
    description: string;
    type: "workspace-config";
    author?: string | undefined;
    license?: string | undefined;
    tags?: string[] | undefined;
    skills?: string[] | undefined;
    plugins?: string[] | undefined;
    claude_permissions?: {
        allow?: string[] | undefined;
        deny?: string[] | undefined;
        defaultMode?: "default" | "allowedTools" | "autoEdit" | "bypassPermissions" | "plan" | undefined;
    } | undefined;
    mcp_servers?: Record<string, {
        description: string;
        required?: boolean | undefined;
    }> | undefined;
    settings?: {
        retention_days?: number | undefined;
        naming_convention?: string | undefined;
    } | undefined;
    git_workflow?: {
        branch_pattern?: string | undefined;
        base_branch?: string | undefined;
        stash_before_checkout?: boolean | undefined;
        commit_format?: "conventional" | "freeform" | undefined;
        pr_template?: boolean | undefined;
        signed_commits?: boolean | undefined;
    } | undefined;
}>;
export type WorkspaceConfigMeta = z.infer<typeof WorkspaceConfigMetaSchema>;
export type GitWorkflowConfig = z.infer<typeof GitWorkflowConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type WorkspaceSettingsConfig = z.infer<typeof WorkspaceSettingsConfigSchema>;
export {};
//# sourceMappingURL=workspace-config-meta.d.ts.map