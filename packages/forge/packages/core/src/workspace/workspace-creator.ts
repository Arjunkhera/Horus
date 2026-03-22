import { promises as fs } from 'fs';
import path from 'path';
import type { ForgeCore } from '../core.js';
import { translateRepoPath } from '../core.js';
import { createReferenceClone } from '../repo/repo-clone.js';
import type {
  WorkspaceRecord,
  WorkspaceRepo,
  WorkspaceConfigMeta,
  RepoIndexEntry,
} from '../models/index.js';
import { WorkspaceMetadataStore, generateWorkspaceId } from './workspace-metadata-store.js';
import { WorkspaceManager } from './workspace-manager.js';
import { loadGlobalConfig } from '../config/global-config-loader.js';
import { expandPath } from '../config/path-utils.js';
import { loadRepoIndex } from '../repo/repo-index-store.js';
import { RepoIndexQuery } from '../repo/repo-index-query.js';
import { updateClaudeMcpServers, updateCursorMcpServers, emitPreToolUseHook, type McpServerEntry } from './mcp-settings-writer.js';
import type { ClaudePermissions } from '../models/global-config.js';

/**
 * Options for creating a new workspace.
 */
export interface WorkspaceCreateOptions {
  configName: string;           // workspace config artifact ID (e.g., "sdlc-default")
  configVersion?: string;       // version constraint (default: '*')
  storyId?: string;
  storyTitle?: string;
  repos?: string[];             // specific repo names to include
  mountPath?: string;           // override global workspace.mount_path
}

/**
 * Custom error type for workspace creation failures.
 */
export class WorkspaceCreateError extends Error {
  constructor(message: string, public readonly suggestion?: string) {
    super(message);
    this.name = 'WorkspaceCreateError';
    Object.setPrototypeOf(this, WorkspaceCreateError.prototype);
  }
}

/**
 * Helper: Convert text to lowercase kebab-case, max 30 chars.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
}

/**
 * Helper: Generate branch name from pattern, replacing {subtype}, {id}, {slug}.
 */
export function generateBranchName(
  pattern: string,
  vars: { subtype?: string; id?: string; slug?: string },
): string {
  let result = pattern;
  if (vars.subtype !== undefined) {
    result = result.replace(/{subtype}/g, vars.subtype);
  }
  if (vars.id !== undefined) {
    result = result.replace(/{id}/g, vars.id);
  }
  if (vars.slug !== undefined) {
    result = result.replace(/{slug}/g, vars.slug);
  }
  // Remove any remaining unfilled placeholders
  result = result.replace(/{[^}]+}/g, '');
  // Clean up double slashes
  result = result.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  return result || 'workspace';
}

/**
 * Merge Claude permissions from workspace config (defaults) and per-user config (overrides).
 * Per-user entries are added on top of workspace config entries, with deduplication.
 * Returns undefined only if neither source provides permissions.
 */
function mergeClaudePermissions(
  workspaceConfig?: ClaudePermissions,
  userConfig?: ClaudePermissions,
): ClaudePermissions | undefined {
  if (!workspaceConfig && !userConfig) return undefined;

  const allow = [...(workspaceConfig?.allow ?? [])];
  for (const entry of userConfig?.allow ?? []) {
    if (!allow.includes(entry)) allow.push(entry);
  }

  const deny = [...(workspaceConfig?.deny ?? [])];
  for (const entry of userConfig?.deny ?? []) {
    if (!deny.includes(entry)) deny.push(entry);
  }

  return { allow, deny };
}

/**
 * Main workspace creator class.
 */
export class WorkspaceCreator {
  constructor(private readonly forge: ForgeCore) {}

  async create(options: WorkspaceCreateOptions): Promise<WorkspaceRecord> {
    // Step 1: Resolve workspace config from registry
    let configArtifact;
    try {
      const refString = `workspace-config:${options.configName}@${options.configVersion ?? '*'}`;
      configArtifact = await this.forge.resolve(refString);
    } catch (err: any) {
      throw new WorkspaceCreateError(
        `Workspace config '${options.configName}' not found in registry`,
        `Available configs: forge list --available -t workspace-config`,
      );
    }

    const workspaceConfigMeta = configArtifact.bundle.meta as WorkspaceConfigMeta;

    // Step 2: Determine mount path
    const globalConfig = await loadGlobalConfig();
    const mountPath = expandPath(options.mountPath ?? globalConfig.workspace.mount_path);

    // Step 3: Generate workspace name and ID
    const id = generateWorkspaceId();
    const slugPart = options.storyId ?? id;
    const name = `${options.configName}-${slugPart}`;
    const workspacePath = path.join(mountPath, name);

    // Step 4: Resolve repos (if specified)
    let resolvedRepos: RepoIndexEntry[] = [];
    if (options.repos && options.repos.length > 0) {
      const repoIndex = await loadRepoIndex(globalConfig.repos.index_path);
      if (!repoIndex) {
        throw new WorkspaceCreateError(
          'Repository index not found',
          'Run: forge repo scan',
        );
      }

      const query = new RepoIndexQuery(repoIndex.repos);
      for (const repoName of options.repos) {
        const repo = query.findByName(repoName);
        if (!repo) {
          throw new WorkspaceCreateError(
            `Repository "${repoName}" not found in local index`,
            'Run: forge repo scan',
          );
        }
        resolvedRepos.push(repo);
      }
    }

    // Step 5: Create workspace folder
    try {
      await fs.mkdir(workspacePath, { recursive: true });
    } catch (err: any) {
      throw new WorkspaceCreateError(
        `Failed to create workspace folder at ${workspacePath}: ${err.message}`,
      );
    }

    try {
      // Step 6: Create reference clones for each repo
      const { scan_paths, host_repos_path } = globalConfig.repos;
      const reposWithWorktrees: WorkspaceRepo[] = [];
      for (const repo of resolvedRepos) {
        const branchName = generateBranchName(
          workspaceConfigMeta.git_workflow.branch_pattern,
          {
            subtype: 'feature',
            id: options.storyId ?? id,
            slug: slugify(options.storyTitle ?? options.configName),
          },
        );

        const clonePath = path.join(workspacePath, repo.name);
        // Translate to host path for storage/display; git ops use original Docker-internal path
        const translatedRepo = translateRepoPath(repo, scan_paths, host_repos_path);

        try {
          await createReferenceClone({
            localPath: repo.localPath,   // Docker-internal — accessible from within the container
            remoteUrl: repo.remoteUrl,
            destPath: clonePath,
            branchName,
            defaultBranch: repo.defaultBranch,
          });

          reposWithWorktrees.push({
            name: repo.name,
            localPath: translatedRepo.localPath,  // host path for record/CLAUDE.md
            branch: branchName,
            worktreePath: clonePath,
          });
        } catch (err: any) {
          // Graceful fallback: log warning but continue without clone
          console.warn(`[Forge] Warning: Could not create reference clone for ${repo.name}: ${err.message}`);
          reposWithWorktrees.push({
            name: repo.name,
            localPath: translatedRepo.localPath,  // host path for record/CLAUDE.md
            branch: branchName,
            worktreePath: null,
          });
        }
      }

      // Step 7: Create workspace forge.yaml and install plugins/skills
      const workspaceForgeConfig = {
        name,
        version: '0.1.0',
        target: 'claude-code' as const,
        outputDir: '.',
        registries: globalConfig.registries,
        artifacts: {
          skills: Object.fromEntries(
            workspaceConfigMeta.skills.map(s => [s, '*']),
          ),
          agents: {},
          plugins: Object.fromEntries(
            workspaceConfigMeta.plugins.map(p => [p, '*']),
          ),
          'workspace-configs': {},
        },
      };

      const workspaceManager = new WorkspaceManager(workspacePath);
      await workspaceManager.writeConfig(workspaceForgeConfig);

      // Install using a new ForgeCore instance for this workspace
      let workspaceForge: InstanceType<typeof import('../core.js').ForgeCore> | null = null;
      try {
        workspaceForge = new (await import('../core.js')).ForgeCore(workspacePath);
        await workspaceForge.install({
          target: 'claude-code',
          conflictStrategy: 'overwrite',
        });
      } catch (err: any) {
        console.warn(`[Forge] Warning: Failed to install plugins (claude-code): ${err.message}`);
      }

      // Install Cursor target in parallel — skills emit to .cursor/rules/*.mdc
      try {
        if (!workspaceForge) {
          workspaceForge = new (await import('../core.js')).ForgeCore(workspacePath);
        }
        await workspaceForge.install({
          target: 'cursor',
          conflictStrategy: 'overwrite',
        });
      } catch (err: any) {
        console.warn(`[Forge] Warning: Failed to install plugins (cursor): ${err.message}`);
      }

      // Step 8: Emit MCP configs
      const mcpDir = path.join(workspacePath, '.claude', 'mcp-servers');
      await fs.mkdir(mcpDir, { recursive: true });

      for (const [serverName, serverConfig] of Object.entries(
        workspaceConfigMeta.mcp_servers,
      )) {
        const endpoint =
          globalConfig.mcp_endpoints[serverName as keyof typeof globalConfig.mcp_endpoints];

        if (!endpoint && serverConfig.required) {
          console.warn(
            `[Forge] Warning: MCP endpoint '${serverName}' not configured in ~/Horus/data/config/forge.yaml`,
          );
          continue;
        }

        if (endpoint) {
          const mcpConfig = {
            name: serverName,
            url: endpoint.url,
            transport: endpoint.transport,
          };
          await fs.writeFile(
            path.join(mcpDir, `${serverName}.json`),
            JSON.stringify(mcpConfig, null, 2),
            'utf-8',
          );
        }
      }

      // Compute host-side workspace path. When Forge runs in Docker, host_workspaces_path
      // translates the bind-mount root; for native installs both paths are identical.
      const hostMountPath = globalConfig.workspace.host_workspaces_path
        ? globalConfig.workspace.host_workspaces_path
        : mountPath;
      const hostWorkspacePath = path.join(hostMountPath, name);

      // Step 8a: Register MCP servers in {workspace}/.claude/settings.local.json using the
      // managed wrapper script. Ensures mcp-remote processes self-terminate when claude exits
      // (fixes process leak). Uses host_endpoints URLs so Claude Code on the host can connect.
      try {
        const mcpServersToRegister: McpServerEntry[] = [];
        for (const [serverName] of Object.entries(workspaceConfigMeta.mcp_servers)) {
          // Prefer host_endpoints (correct for Docker) over mcp_endpoints (container-internal).
          const hostEndpoint =
            globalConfig.host_endpoints?.[serverName as keyof typeof globalConfig.host_endpoints];
          const endpoint =
            globalConfig.mcp_endpoints[serverName as keyof typeof globalConfig.mcp_endpoints];
          const url = hostEndpoint ?? endpoint?.url;
          if (url) {
            mcpServersToRegister.push({ name: serverName, url });
          }
        }
        // Merge permissions: workspace config provides defaults, per-user config overrides.
        const mergedPermissions = mergeClaudePermissions(
          workspaceConfigMeta.claude_permissions,
          globalConfig.claude_permissions,
        );
        await updateClaudeMcpServers(mcpServersToRegister, workspacePath, hostWorkspacePath, mergedPermissions);
      } catch (err: any) {
        console.warn(`[Forge] Warning: Could not update .claude/settings.local.json: ${err.message}`);
      }

      // Step 8a-cursor: Register MCP servers in {workspace}/.cursor/mcp.json for Cursor IDE.
      try {
        const cursorMcpServers: McpServerEntry[] = [];
        for (const [serverName] of Object.entries(workspaceConfigMeta.mcp_servers)) {
          const hostEndpoint =
            globalConfig.host_endpoints?.[serverName as keyof typeof globalConfig.host_endpoints];
          const endpoint =
            globalConfig.mcp_endpoints[serverName as keyof typeof globalConfig.mcp_endpoints];
          const url = hostEndpoint ?? endpoint?.url;
          if (url) {
            cursorMcpServers.push({ name: serverName, url });
          }
        }
        await updateCursorMcpServers(cursorMcpServers, workspacePath);
      } catch (err: any) {
        console.warn(`[Forge] Warning: Could not write .cursor/mcp.json: ${err.message}`);
      }

      // Step 8b: Emit PreToolUse hook to block edits to source repos.
      // Uses a git-based heuristic — no hardcoded paths needed. The guard script
      // blocks edits to any git repo that isn't inside a Horus workspace directory.
      try {
        await emitPreToolUseHook(workspacePath, hostWorkspacePath);
      } catch (err: any) {
        console.warn(`[Forge] Warning: Could not emit PreToolUse hook: ${err.message}`);
      }

      // Step 9: Emit environment variables file
      // Resolve workflow metadata for the first repo (drives PR strategy in scripts)
      let workflowStrategy = '';
      let prTarget = '';
      if (resolvedRepos.length > 0) {
        try {
          const repoWorkflow = await this.forge.repoWorkflow(resolvedRepos[0].name);
          workflowStrategy = repoWorkflow.workflow.strategy;
          prTarget = repoWorkflow.workflow.prTarget;
        } catch {
          // Non-fatal: workflow vars will be empty
        }
      }

      const envVars: Record<string, string> = {
        SDLC_BRANCH_PATTERN: workspaceConfigMeta.git_workflow.branch_pattern,
        SDLC_BASE_BRANCH: workspaceConfigMeta.git_workflow.base_branch,
        SDLC_COMMIT_FORMAT: workspaceConfigMeta.git_workflow.commit_format,
        SDLC_STASH_BEFORE_CHECKOUT: String(
          workspaceConfigMeta.git_workflow.stash_before_checkout,
        ),
        SDLC_PR_TEMPLATE: String(workspaceConfigMeta.git_workflow.pr_template),
        SDLC_SIGNED_COMMITS: String(workspaceConfigMeta.git_workflow.signed_commits),
        FORGE_WORKSPACE_ID: id,
        FORGE_WORKSPACE_NAME: name,
        FORGE_WORKSPACE_PATH: workspacePath,
        FORGE_HOST_WORKSPACE_PATH: hostWorkspacePath,
      };

      if (workflowStrategy) envVars['SDLC_WORKFLOW_STRATEGY'] = workflowStrategy;
      if (prTarget) envVars['SDLC_PR_TARGET'] = prTarget;
      if (host_repos_path) envVars['SDLC_SOURCE_REPOS_PATH'] = host_repos_path;

      const envContent = Object.entries(envVars)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n') + '\n';

      await fs.writeFile(
        path.join(workspacePath, 'workspace.env'),
        envContent,
        'utf-8',
      );

      // Step 10: Emit CLAUDE.md
      const claudeMd = `# Workspace: ${name}

> Created: ${new Date().toISOString().slice(0, 10)} | Config: ${options.configName}

## Context
${options.storyTitle ? `Story: ${options.storyTitle} (${options.storyId})` : 'No story linked'}

## Repositories
${reposWithWorktrees.map(r => `- **${r.name}**: ${r.worktreePath ? path.join(hostWorkspacePath, r.name) : r.localPath}`).join('\n') || '(none)'}

## MCP Servers
${Object.keys(workspaceConfigMeta.mcp_servers).map(s => `- ${s}`).join('\n') || '(none configured)'}

## Environment
Source \`workspace.env\` for SDLC environment variables.
`;
      await fs.writeFile(path.join(workspacePath, 'CLAUDE.md'), claudeMd, 'utf-8');

      // Step 10b: Emit .cursorrules (Cursor equivalent of CLAUDE.md)
      const cursorRules = `# Workspace: ${name}

> Created: ${new Date().toISOString().slice(0, 10)} | Config: ${options.configName}

## Context
${options.storyTitle ? `Story: ${options.storyTitle} (${options.storyId})` : 'No story linked'}

## Repositories
${reposWithWorktrees.map(r => `- **${r.name}**: ${r.worktreePath ? path.join(hostWorkspacePath, r.name) : r.localPath}`).join('\n') || '(none)'}

## MCP Servers
${Object.keys(workspaceConfigMeta.mcp_servers).map(s => `- ${s}`).join('\n') || '(none configured)'}

## Environment
Source \`workspace.env\` for SDLC environment variables.

## Limitations
- Source repository edit guards (PreToolUse hooks) are not available in Cursor.
  Use \`forge_repo_clone\` MCP tool to get isolated working copies before editing repo files.
`;
      await fs.writeFile(path.join(workspacePath, '.cursorrules'), cursorRules, 'utf-8');

      // Step 11: Register workspace in metadata store
      const metaStore = new WorkspaceMetadataStore(globalConfig.workspace.store_path);
      const record: WorkspaceRecord = {
        id,
        name,
        configRef: `${options.configName}@${configArtifact.ref.version}`,
        storyId: options.storyId ?? null,
        storyTitle: options.storyTitle ?? null,
        path: workspacePath,
        status: 'active',
        repos: reposWithWorktrees,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        completedAt: null,
      };

      await metaStore.create(record);
      return record;
    } catch (err: any) {
      // Clean up workspace folder on failure
      try {
        await fs.rm(workspacePath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

      // Re-throw or wrap error
      if (err instanceof WorkspaceCreateError) {
        throw err;
      }
      throw new WorkspaceCreateError(
        `Failed to create workspace: ${err.message}`,
        'Check logs above for details',
      );
    }
  }
}
