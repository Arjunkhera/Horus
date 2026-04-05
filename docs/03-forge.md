# Forge — Execution Layer

Forge manages the developer's execution environment. It provides context-only workspaces, isolated code sessions, a repository index, and a versioned artifact system for skills, plugins, and agents.

## Architecture

```
Claude Code / Cursor
       |
       | MCP Protocol (stdio or HTTP)
       v
+---------------------+
|  Forge MCP Server   |
|  (Node.js, :8200)   |
+----------+----------+
           |
           v
+---------------------+
|     ForgeCore       |     Main orchestrator
+--+--+--+--+--+-----+
   |  |  |  |  |
   v  v  v  v  v
  WS  SS  RI  RG  CM
```

**Subsystems:**
- **WS** — Workspace system (create, lifecycle, metadata store)
- **SS** — Session system (forge_develop, git worktrees)
- **RI** — Repository index (scan, query, workflow detection)
- **RG** — Registry (search, resolve, install artifacts)
- **CM** — Compiler (emit files for Claude Code / Cursor targets)

## Core Concepts

### Workspaces — Context Containers

A workspace is a **context-only folder** that configures an AI agent's environment. It does NOT clone repositories or create worktrees. Workspaces provide:

- **MCP server connections** (Anvil, Vault, Forge endpoints)
- **Installed skills and plugins** (emitted as CLAUDE.md rules / .cursorrules)
- **Environment variables** (SDLC git workflow config)
- **Claude permissions** (allow/deny rules for tools)
- **PreToolUse guard hook** (prevents edits to files outside workspace)

```
Workspace folder structure:
sdlc-default-ws-abc12345/
├── forge.yaml                  # Artifact config (skills, plugins)
├── forge.lock                  # Installed artifact versions + file hashes
├── CLAUDE.md                   # Agent context (repos, MCP servers, instructions)
├── .cursorrules                # Cursor equivalent of CLAUDE.md
├── workspace.env               # SDLC environment variables
├── .claude/
│   ├── settings.json           # Project-level permissions
│   ├── settings.local.json     # MCP server URLs (machine-specific)
│   ├── mcp-servers/            # Individual MCP server configs
│   │   ├── anvil.json
│   │   ├── vault.json
│   │   └── forge.json
│   ├── scripts/
│   │   └── guard-source-repos.sh   # PreToolUse hook
│   └── commands/               # Installed skill files
└── .cursor/
    ├── mcp.json                # Cursor MCP server config
    └── rules/                  # Installed skill files (.mdc)
```

**What a workspace is NOT:**
- NOT a git repository or worktree
- NOT tied to a specific story (storyId is optional metadata)
- NOT where code changes happen (that's sessions)

### Sessions — Isolated Code Environments

Sessions are created by `forge_develop` and provide **git worktrees** for isolated coding. Each session is linked to:
- A **repository** (resolved from the repo index)
- A **work item** (Anvil note ID or slug)

```
Session creation flow:

forge_develop(repo: "my-repo", workItem: "task-abc")
       |
       v
1. Resolve repo (3-tier lookup)
       |
       v
2. Check for existing session → resume if found
       |
       v
3. Verify/accept workflow config
       |
       v
4. git fetch on base repo
       |
       v
5. git worktree add {sessionPath} -b {branch} {baseBranch}
       |
       v
6. Install git enforcement hooks
       |
       v
7. Save session record to sessions.json
       |
       v
Returns: { sessionId, sessionPath, branch, ... }
```

**Session Record:**
```
{
  sessionId: "sess-abc123",
  workItem: "task-abc",
  repo: "my-repo",
  branch: "feature/task-abc-my-feature",
  baseBranch: "main",
  sessionPath: "/path/to/sessions/task-abc-my-repo",
  hostSessionPath: "/host/path/...",  // Docker only
  repoSource: "user",                 // user | managed | cloned
  workflow: {
    type: "owner",                     // owner | fork | contributor
    pushTo: "origin",
    prTarget: { repo: "org/repo", branch: "main" }
  },
  agentSlot: 1,                        // 1 = primary, 2+ = concurrent
  createdAt: "2026-03-22T10:00:00Z",
  lastModified: "2026-03-22T14:00:00Z"
}
```

**Key behaviors:**
- **Resume**: If a session already exists for the same workItem + repo, it resumes (updates `lastModified`)
- **Concurrent agents**: Same workItem can have multiple sessions (slots 1, 2, 3...). Slot 1 path: `{slug}-{repo}`, slot 2+: `{slug}-{repo}-2`
- **Max sessions ceiling**: Configurable (default 20), warns when reached, suggests cleanup

### Repository Index

Forge maintains a local index of git repositories for quick lookup and workflow resolution.

```
Repository resolution (3-tier):

Tier 1 (user):     ~/Repositories/ (configurable scan paths)
                    Indexed repos found by scanning directories
                           |
                    Found? → Use it
                           |
Tier 2 (managed):  ~/Horus/data/repos/ (managed pool)
                    Repos cloned/managed by Forge
                           |
                    Found? → Use it
                           |
Tier 3 (cloned):   Clone from remote
                    ⚠️ NOT YET SUPPORTED — returns error
```

**Repo Index Entry:**
```
{
  name: "Horus",
  localPath: "/Users/.../Horus",
  remoteUrl: "git@github.com:Arjunkhera/Horus.git",
  defaultBranch: "master",
  language: "JavaScript",     // Detected from marker files
  framework: null,            // Detected from package.json deps
  lastCommitDate: "2026-03-22",
  lastScannedAt: "2026-03-22T16:17:38Z",
  workflow?: { ... }          // Confirmed workflow (optional)
}
```

**Language detection** (by marker files): tsconfig.json → TypeScript, package.json → JavaScript, pyproject.toml → Python, Cargo.toml → Rust, go.mod → Go, pom.xml → Java

**Framework detection** (JS/TS only): React, Next.js, Express, Fastify, Vue

### Workflow Detection

When creating a session, Forge needs to know how to push code and create PRs. Resolution order:

```
1. Vault repo-profile page       (highest priority)
   └── Extracts hosting + workflow fields
2. Auto-detect from git remotes
   └── "upstream" remote → fork workflow
   └── No upstream → owner workflow (direct push)
3. Defaults
   └── owner workflow, push to origin
```

**Workflow types:**
| Type | Description | Push To | PR Target |
|------|-------------|---------|-----------|
| `owner` | Direct push to main repo | `origin` | Same repo, default branch |
| `fork` | Push to fork, PR to upstream | `origin` (fork) | Upstream repo |
| `contributor` | External contributor | `origin` | Upstream repo |

**Confirmed workflow** (saved to repo index after user/auto confirmation):
```
{
  type: "owner" | "fork" | "contributor",
  upstream?: "git@github.com:...",
  fork?: "git@github.com:...",
  pushTo: "origin",
  prTarget: { repo: "org/repo", branch: "main" },
  branchPattern?: "{type}/{id}-{slug}",
  commitFormat?: "conventional",
  confirmedAt: "2026-03-22T...",
  confirmedBy: "user" | "auto"
}
```

### Artifact System

Forge manages four types of versioned artifacts:

| Type | Content File | Description |
|------|-------------|-------------|
| `skill` | `SKILL.md` | Opaque markdown emitted as agent instructions |
| `agent` | `AGENT.md` | Agent definition with root skill + dependencies |
| `plugin` | `PLUGIN.md` (optional) | Bundle of skills + agents |
| `workspace-config` | `WORKSPACE.md` (optional) | Workspace template with MCP servers, git config, permissions |

**Reference format:** `type:id@version` (e.g., `skill:developer@1.0.0`)

**Dependency resolution:**
- Skills: `meta.dependencies` (id → semver range)
- Agents: `meta.dependencies` + `meta.skills[]`
- Plugins: `meta.skills[]` (implicit deps)
- Workspace-configs: `meta.plugins[]` + `meta.skills[]`

Circular dependencies are detected and prevented. In-memory caching per install run.

**Registry structure** (filesystem-based):
```
registry/
├── skills/
│   └── developer/
│       ├── metadata.yaml
│       └── SKILL.md
├── agents/
│   └── sdlc-implement-story/
│       ├── metadata.yaml
│       └── AGENT.md
├── plugins/
│   └── anvil-sdlc-v2/
│       └── metadata.yaml
└── workspace-configs/
    └── sdlc-default/
        ├── metadata.yaml
        └── WORKSPACE.md
```

**Search scoring:** id match (highest) > name match > description match > tag match

**Install pipeline:**
```
1. Read forge.yaml (artifact declarations)
2. Resolve each artifact + dependencies (recursive)
3. Compile to FileOperations (target-specific)
4. Merge files into workspace (conflict resolution)
5. Update forge.lock (versions, hashes, file paths)
6. Clean untracked files from previous installs
```

**Compilation targets:**
| Target | Output Directory | Format |
|--------|-----------------|--------|
| `claude-code` | `.claude/` | Markdown commands |
| `cursor` | `.cursor/rules/` | `.mdc` files |

### Workspace Config Metadata

The workspace-config artifact defines what a workspace contains:

```yaml
id: sdlc-default
name: SDLC Default Workspace
version: 1.2.0
type: workspace-config
plugins: [anvil-sdlc-v2]
skills: [developer, commit, review-pr]
mcp_servers:
  anvil:
    description: Notes and work items
    required: true
  vault:
    description: Knowledge base
    required: true
  forge:
    description: Workspace and repo management
    required: true
settings:
  retention_days: 30
git_workflow:
  branch_pattern: "{subtype}/{id}-{slug}"
  base_branch: main
  stash_before_checkout: true
  commit_format: conventional
  pr_template: true
  signed_commits: false
claude_permissions:
  allow: ["mcp__*__*"]
  deny: []
  defaultMode: bypassPermissions
```

## MCP Tools

### Workspace Tools

#### forge_workspace_create

Creates a context-only workspace from a workspace config.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `config` | string | yes | Workspace config ID (e.g., `"sdlc-default"`) |
| `configVersion` | string | no | Version constraint (default: latest) |
| `repos` | string[] | no | Repo names to include (context only, no cloning) |
| `storyId` | string | no | Anvil work item ID (optional metadata) |
| `storyTitle` | string | no | Cached story title for display |

**Process:**
1. Resolve workspace-config artifact from registry
2. Determine mount path from global config
3. Generate workspace ID (`ws-{8chars}`) and name
4. Resolve repos from index (record localPath, no cloning)
5. Create workspace folder
6. Write forge.yaml and install plugins/skills (both Claude Code and Cursor targets)
7. Emit MCP server configs to `.claude/mcp-servers/` and register in settings files
8. Emit PreToolUse guard hook (blocks edits outside workspace)
9. Write `workspace.env`, `CLAUDE.md`, `.cursorrules`
10. Register workspace in metadata store

**Returns:** WorkspaceRecord

#### forge_workspace_list

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | string | no | Filter: active/paused/completed/archived |
| `storyId` | string | no | Filter by linked story |

#### forge_workspace_status

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Workspace ID |

**Returns:** Full workspace record (name, config, status, path, repos, timestamps)

#### forge_workspace_delete

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Workspace ID |
| `force` | boolean | no | Force delete |

Removes workspace folder from disk and deletes metadata record. Does NOT touch git worktrees (those belong to sessions).

### Workspace Lifecycle

```
         +---------+
    +--->| active  |---+---+---+
    |    +---------+   |   |   |
    |         |        |   |   |
    |    pause|        |   |   |
    |         v        |   |   |
    |    +---------+   |   |   |
    +----| paused  |---+   |   |
  resume +---------+   |   |   |
              |   complete |   |
              |        |   |   |
              v        v   |   |
         +-----------+     |   |
         | completed |-----+   |
         +-----------+     |   |
              |       archive  |
              v            |   |
         +-----------+     |   |
         | archived  |<----+---+
         +-----------+
         (terminal)

    Any state → deleted (removes from disk + store)
```

**Retention cleanup:** Removes active/paused workspaces older than N days (default 30).

### Session Tools

#### forge_develop

Creates or resumes an isolated code session (git worktree).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repo` | string | yes | Repository name |
| `workItem` | string | yes | Anvil note ID or slug |
| `branch` | string | no | Custom branch name |
| `workflow` | object | no | Inline workflow config (skip confirmation) |

**Process:**
1. Resolve repo via 3-tier lookup (user repos → managed pool → error)
2. Check for existing session → resume if found (updates lastModified)
3. Verify workflow is confirmed (or accept inline workflow input)
4. `git fetch` on base repo
5. `git worktree add {sessionPath} -b {featureBranch} {baseBranch}`
6. Install enforcement hooks
7. Save session record

**Returns:** `{ sessionId, sessionPath, hostSessionPath, branch, baseBranch, workflow, resumed }`

#### forge_session_list

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repo` | string | no | Filter by repository |
| `workItem` | string | no | Filter by work item |

**Returns:** Array of session records

#### forge_session_cleanup

Cleans up stale code sessions (removes git worktrees).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `workItem` | string | no | Clean sessions for specific work item |
| `olderThan` | string | no | Age threshold (e.g., `"30d"`) |
| `auto` | boolean | no | Auto-cleanup based on Anvil note status |

**Auto-cleanup policy** (checks Anvil note status):
| Anvil Status | Age | Action |
|-------------|-----|--------|
| `done` | > 7 days | Eligible for cleanup |
| `cancelled` | Any | Immediately eligible |
| `in_progress` / `in_review` | Any | Skip (active work) |
| Not found | Any | Warn, skip |

**Cleanup process:**
1. `git worktree remove --force {sessionPath}`
2. `git worktree prune` on base repo
3. Remove session directory
4. Delete session record

### Repository Tools

#### forge_repo_list

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | no | Filter by name/path/URL |
| `language` | string | no | Filter by language |

#### forge_repo_resolve

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | no | Repository name |
| `remoteUrl` | string | no | Remote URL (HTTPS or SSH) |

**Returns:** Repo index entry (name, localPath, remoteUrl, defaultBranch, language, framework)

#### forge_repo_workflow

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Repository name |
| `workflow` | object | no | Workflow config to save/confirm |

**Resolution order:** Vault repo-profile → auto-detect from git remotes → defaults

**Returns:** `{ workflow: { strategy, defaultBranch, prTarget, ... } }`

### Artifact Tools

#### forge_search

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query |
| `type` | string | no | `skill`, `agent`, or `plugin` |

#### forge_resolve

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ref` | string | yes | Artifact ref (e.g., `"plugin:anvil-sdlc-v2"`) |

**Returns:** Artifact metadata + resolved dependencies

#### forge_add

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `refs` | string[] | yes | Array of ref strings |

Adds artifact references to the workspace's `forge.yaml`.

#### forge_install

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | string | no | `claude-code`, `cursor`, or `plugin` |
| `dryRun` | boolean | no | Preview without writing |

Runs full install pipeline: resolve → compile → merge → lock.

#### forge_list

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `scope` | string | no | `installed` or `available` |
| `type` | string | no | Artifact type filter |

## Configuration

### Global Config (`~/Horus/data/config/forge.yaml`)

```yaml
registries:
  - type: filesystem
    name: local
    path: ~/Horus/data/registry

workspace:
  mount_path: ~/Horus/data/workspaces
  default_config: sdlc-default
  retention_days: 30
  store_path: ~/Horus/data/workspaces.json
  sessions_path: ~/Horus/data/sessions.json
  managed_repos_path: ~/Horus/data/repos
  sessions_root: ~/Horus/data/sessions
  max_sessions: 20
  host_workspaces_path: ...    # Docker only
  host_repos_path: ...         # Docker only

mcp_endpoints:                  # Container-internal URLs
  anvil: { url: "http://...", transport: "http" }
  vault: { url: "http://...", transport: "http" }
  forge: { url: "http://...", transport: "http" }

host_endpoints:                 # Host-facing URLs (Docker)
  anvil: "http://localhost:8100/mcp"
  vault: "http://localhost:8300/mcp"
  forge: "http://localhost:8200/mcp"

repos:
  scan_paths: [~/Repositories, ~/Projects]
  index_path: ~/Horus/data/repos.json
  host_repos_path: ...         # Docker only

claude_permissions:
  allow: [...]
  deny: [...]
```

### Workspace Config (`forge.yaml` in workspace root)

```yaml
name: sdlc-default-ws-abc12345
version: 0.1.0
target: claude-code
registries:
  - type: filesystem
    name: local
    path: ~/Horus/data/registry
artifacts:
  skills:
    developer: "*"
    commit: "*"
  agents: {}
  plugins:
    anvil-sdlc-v2: "*"
  workspace-configs: {}
```

### Lock File (`forge.lock` in workspace root)

```yaml
version: "1"
lockedAt: "2026-03-22T10:00:00Z"
artifacts:
  "skill:developer":
    id: developer
    type: skill
    version: "1.0.0"
    registry: local
    sha256: abc123...
    files: [".claude/commands/developer.md"]
    resolvedAt: "2026-03-22T10:00:00Z"
```

## Forge → Vault Integration

Forge reads Vault repo-profile pages to resolve git workflow configuration:

```
forge_repo_workflow("my-repo")
       |
       v
1. Check repo index for confirmed workflow
   Found? → Return it
       |
       v
2. Query Vault: GET /get-page for repos/{name}.md
   Found? → Extract hosting + workflow fields
       |
       v
3. Auto-detect from git remotes
   "upstream" remote → fork workflow
   No upstream → owner workflow
       |
       v
4. Return workflow config
```

The Vault client (`vault-client.ts` in Forge core) is a lightweight HTTP client that fetches repo-profile pages and extracts workflow metadata. It degrades gracefully on network failure.

## Forge → Anvil Integration

Session cleanup checks Anvil note status to determine staleness:

```
forge_session_cleanup(auto: true)
       |
       v
For each session:
  1. Look up workItem in Anvil
  2. Check note status:
     - done (>7 days old) → clean up
     - cancelled → clean up immediately
     - in_progress / in_review → skip
     - not found → warn, skip
  3. Remove git worktree + session record
```
