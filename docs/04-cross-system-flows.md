# Cross-System Flows

This document describes the end-to-end workflows that span multiple Horus systems.

## Flow 1: Starting a New Development Task

This is the most common flow — a developer wants to start coding on a task.

```
Step 1: Create or find the work item (Anvil)
─────────────────────────────────────────────
anvil_create_note(type: "story", title: "Add user auth", fields: { status: "open" })
  → Returns: { noteId: "abc-123", ... }

        OR

anvil_search(query: "user auth", type: "story")
  → Returns existing story


Step 2: Create a workspace (Forge)
──────────────────────────────────
forge_workspace_create(config: "sdlc-default")
  → Creates context folder with:
    - MCP server connections (Anvil, Vault, Forge)
    - Installed skills and plugins
    - CLAUDE.md with workspace context
    - workspace.env with SDLC variables
    - Claude permissions and guard hooks


Step 3: Open workspace in Claude Code / Cursor
───────────────────────────────────────────────
cd ~/Horus/data/workspaces/sdlc-default-ws-abc12345
claude   # or cursor .

Agent now has:
  ✓ Access to Anvil (notes, tasks, stories)
  ✓ Access to Vault (codebase knowledge, conventions)
  ✓ Access to Forge (repo management, sessions)
  ✓ Installed skills (developer, commit, review-pr, etc.)
  ✓ Guard hook preventing edits to source repos


Step 4: Get codebase context (Vault)
────────────────────────────────────
knowledge_resolve_context(repo: "my-repo", include_full: true)
  → Returns: repo-profile + all operational guides/procedures


Step 5: Create a code session (Forge)
─────────────────────────────────────
forge_develop(repo: "my-repo", workItem: "abc-123")
  → Creates git worktree at ~/Horus/data/sessions/abc-123-my-repo/
  → Returns: { sessionPath, branch: "feature/abc-123-add-user-auth" }

Agent can now:
  ✓ Read/write code in the session worktree
  ✓ Commit and push from the worktree
  ✓ Create PRs via gh CLI


Step 6: Update work item status (Anvil)
───────────────────────────────────────
anvil_update_note(noteId: "abc-123", fields: { status: "in-progress" })
```

## Flow 2: Cleaning Up After Work

```
Step 1: Mark work as done (Anvil)
─────────────────────────────────
anvil_update_note(noteId: "abc-123", fields: { status: "done" })


Step 2: Clean up code sessions (Forge)
──────────────────────────────────────
forge_session_cleanup(auto: true)
  → Checks Anvil status for each session's workItem
  → "done" + older than 7 days → removes git worktree
  → "cancelled" → removes immediately
  → "in_progress" → skips


Step 3: Complete workspace (Forge)
─────────────────────────────────
forge_workspace_delete(id: "ws-abc12345")
  → Removes workspace folder from disk
  → Deletes metadata record

  OR (if you want to keep the record):

Use lifecycle: active → completed → archived
```

## Flow 3: Understanding a Codebase Before Coding

```
Step 1: Find the repo (Forge)
────────────────────────────
forge_repo_resolve(name: "my-repo")
  → Returns: { localPath, language, framework, defaultBranch }


Step 2: Get knowledge context (Vault)
─────────────────────────────────────
knowledge_resolve_context(repo: "my-repo")
  → Returns:
    - entry_point: repo-profile (tech stack, conventions, test commands)
    - operational_pages: guides and procedures that apply

knowledge_get_page(id: "repos/my-repo.md")
  → Full repo-profile with body content


Step 3: Explore related knowledge (Vault)
─────────────────────────────────────────
knowledge_get_related(id: "repos/my-repo.md")
  → Follow links: related guides, concepts, procedures

knowledge_search(query: "deployment", scope: { repo: "my-repo" })
  → Find specific topics
```

## Flow 4: Documenting a Discovery

After learning something during development, capture it in the knowledge base.

```
Step 1: Check for existing knowledge (Vault)
────────────────────────────────────────────
knowledge_check_duplicates(
  title: "SQLite WAL Mode Gotcha",
  content: "When running SQLite in WAL mode..."
)
  → Score >= 0.75: novel → create new page
  → Score < 0.75: overlap → merge into existing page


Step 2: Get metadata suggestions (Vault)
────────────────────────────────────────
knowledge_suggest_metadata(
  content: "# SQLite WAL Mode Gotcha\n\nWhen running...",
  hints: { "scope.program": "horus" }
)
  → Suggests: type=learning, mode=reference, tags=[sqlite, database]


Step 3: Validate the page (Vault)
─────────────────────────────────
knowledge_validate_page(content: "---\ntitle: SQLite WAL Mode...\n---\n...")
  → { valid: true } or { errors: [...], warnings: [...] }


Step 4: Write and open PR (Vault)
─────────────────────────────────
knowledge_write_page(
  path: "learnings/sqlite-wal-gotcha.md",
  content: "---\ntitle: ...\n---\n...",
  pr_title: "Add learning: SQLite WAL mode gotcha"
)
  → Returns: PR URL for human review
```

## Flow 5: Multi-Repo Development

Working across multiple repositories in a single workspace.

```
Step 1: Create workspace with multiple repos
────────────────────────────────────────────
forge_workspace_create(
  config: "sdlc-default",
  repos: ["frontend", "backend", "shared-lib"]
)
  → Workspace CLAUDE.md lists all repo paths
  → No cloning — repos referenced by existing local paths


Step 2: Create sessions per repo as needed
──────────────────────────────────────────
forge_develop(repo: "backend", workItem: "feature-123")
  → Session in ~/Horus/data/sessions/feature-123-backend/

forge_develop(repo: "frontend", workItem: "feature-123")
  → Session in ~/Horus/data/sessions/feature-123-frontend/

Both sessions linked to same workItem, different repos.


Step 3: Get context per repo (Vault)
────────────────────────────────────
knowledge_resolve_context(repo: "backend")
knowledge_resolve_context(repo: "frontend")
  → Each returns repo-specific + program-level pages
```

## Flow 6: Resolving Git Workflow for a Repo

```
forge_repo_workflow(name: "my-repo")
       │
       ▼
┌──────────────────────────────┐
│ Check repo index for         │
│ confirmed workflow           │
│ (workflow.confirmedAt set?)  │
└──────────┬───────────────────┘
           │ Not found
           ▼
┌──────────────────────────────┐
│ Query Vault repo-profile     │
│ GET /get-page repos/my-repo  │
│ Extract hosting + workflow   │
└──────────┬───────────────────┘
           │ Not found or no workflow
           ▼
┌──────────────────────────────┐
│ Auto-detect from git remotes │
│ "upstream" → fork workflow   │
│ No upstream → owner workflow │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ Return workflow config       │
│ { type, pushTo, prTarget }   │
└──────────────────────────────┘

To confirm/save a workflow:
forge_repo_workflow(name: "my-repo", workflow: { type: "owner", ... })
  → Saves to repo index with confirmedAt timestamp
```

## Data Flow Summary

```
                         ┌─────────┐
                         │  VAULT  │
                         │         │
                    ┌────┤ Knowledge├────┐
                    │    │  Pages   │    │
                    │    └────┬─────┘    │
                    │         │          │
          repo-profile    search     write-path
          + workflow      results    (via PR)
                    │         │          │
                    ▼         │          │
               ┌─────────┐   │     ┌─────────┐
               │  FORGE   │   │     │  Agent  │
               │          │   │     │(Claude/ │
               │Workspaces│   │     │ Cursor) │
               │ Sessions │   │     │         │
               │  Repos   │◄──┘     └────┬────┘
               └────┬─────┘              │
                    │                    │
         session    │              create/update
         cleanup    │              notes
         checks     │                   │
         status     │                   │
                    │                   │
                    ▼                   ▼
               ┌─────────┐
               │  ANVIL  │
               │         │
               │  Notes  │
               │  Tasks  │
               │ Stories │
               │Journals │
               └─────────┘
```

## System Boundaries

| From | To | Mechanism | Purpose |
|------|----|-----------|---------|
| Forge | Vault | HTTP (vault-client.ts) | Read repo-profile for workflow config |
| Forge | Anvil | MCP (via agent) | Session cleanup checks note status |
| Vault | Git/GitHub | GitHub API + git CLI | Write-path: branch, commit, push, PR |
| Anvil | Git | git CLI | Sync: pull/push notes repo |
| Agent | All three | MCP Protocol | All tool calls |
| Workspace | Agent | Files (CLAUDE.md, .env) | Context injection |
