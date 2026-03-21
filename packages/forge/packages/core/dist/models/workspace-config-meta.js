"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceConfigMetaSchema = void 0;
const zod_1 = require("zod");
const skill_meta_js_1 = require("./skill-meta.js");
const global_config_js_1 = require("./global-config.js");
const McpServerConfigSchema = zod_1.z.object({
    description: zod_1.z.string(),
    required: zod_1.z.boolean().default(true),
});
const GitWorkflowConfigSchema = zod_1.z.object({
    branch_pattern: zod_1.z.string().default('{subtype}/{id}-{slug}'),
    base_branch: zod_1.z.string().default('main'),
    stash_before_checkout: zod_1.z.boolean().default(true),
    commit_format: zod_1.z.enum(['conventional', 'freeform']).default('conventional'),
    pr_template: zod_1.z.boolean().default(true),
    signed_commits: zod_1.z.boolean().default(false),
});
const WorkspaceSettingsConfigSchema = zod_1.z.object({
    retention_days: zod_1.z.number().optional(),
    naming_convention: zod_1.z.string().optional(),
});
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
exports.WorkspaceConfigMetaSchema = zod_1.z.object({
    id: zod_1.z.string().min(1).regex(/^[a-z0-9-]+$/, 'ID must be lowercase kebab-case'),
    name: zod_1.z.string().min(1),
    version: skill_meta_js_1.SemVerSchema,
    description: zod_1.z.string(),
    type: zod_1.z.literal('workspace-config'),
    author: zod_1.z.string().optional(),
    license: zod_1.z.string().optional(),
    tags: zod_1.z.array(zod_1.z.string()).default([]),
    plugins: zod_1.z.array(zod_1.z.string()).default([]),
    skills: zod_1.z.array(zod_1.z.string()).default([]),
    mcp_servers: zod_1.z.record(zod_1.z.string(), McpServerConfigSchema).default({}),
    settings: WorkspaceSettingsConfigSchema.default({}),
    git_workflow: GitWorkflowConfigSchema.default({}),
    claude_permissions: global_config_js_1.ClaudePermissionsSchema.optional(),
});
//# sourceMappingURL=workspace-config-meta.js.map