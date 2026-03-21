import { z } from 'zod';
import { SemVerSchema } from './skill-meta.js';
import { ClaudePermissionsSchema } from './global-config.js';

const McpServerConfigSchema = z.object({
  description: z.string(),
  required: z.boolean().default(true),
});

const GitWorkflowConfigSchema = z.object({
  branch_pattern: z.string().default('{subtype}/{id}-{slug}'),
  base_branch: z.string().default('main'),
  stash_before_checkout: z.boolean().default(true),
  commit_format: z.enum(['conventional', 'freeform']).default('conventional'),
  pr_template: z.boolean().default(true),
  signed_commits: z.boolean().default(false),
});

const WorkspaceSettingsConfigSchema = z.object({
  retention_days: z.number().optional(),
  naming_convention: z.string().optional(),
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
export const WorkspaceConfigMetaSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, 'ID must be lowercase kebab-case'),
  name: z.string().min(1),
  version: SemVerSchema,
  description: z.string(),
  type: z.literal('workspace-config'),
  author: z.string().optional(),
  license: z.string().optional(),
  tags: z.array(z.string()).default([]),
  plugins: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  mcp_servers: z.record(z.string(), McpServerConfigSchema).default({}),
  settings: WorkspaceSettingsConfigSchema.default({}),
  git_workflow: GitWorkflowConfigSchema.default({}),
  claude_permissions: ClaudePermissionsSchema.optional(),
});

export type WorkspaceConfigMeta = z.infer<typeof WorkspaceConfigMetaSchema>;
export type GitWorkflowConfig = z.infer<typeof GitWorkflowConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type WorkspaceSettingsConfig = z.infer<typeof WorkspaceSettingsConfigSchema>;
