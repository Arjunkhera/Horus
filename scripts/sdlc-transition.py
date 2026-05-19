#!/usr/bin/env python3
"""
SDLC Transition Bootstrap
=========================
Run this after any Forge workspace reinstall to restore the transitional
no-forge-develop setup:
  - Removes guard hooks from benchy settings.local.json
  - Adds MCP servers to ~/.claude/settings.json (global)
  - Copies SDLC skills from benchy → ~/.claude/skills/
  - Patches sdlc-developer, sdlc-orchestrator, horus-forge to disable
    forge_develop / forge_repo_resolve / workspace tools

Usage:
    python3 ~/Horus/scripts/sdlc-transition.py

Safe to re-run — all operations are idempotent.
"""

import json
import shutil
import sys
from pathlib import Path

HOME         = Path.home()
BENCHY       = HOME / "Horus/data/workspaces/benchy"
GLOBAL_CFG   = HOME / ".claude/settings.json"
LOCAL_CFG    = BENCHY / ".claude/settings.local.json"
BENCHY_MD    = BENCHY / "CLAUDE.md"
BENCHY_SKILLS = BENCHY / ".claude/skills"
GLOBAL_SKILLS = HOME / ".claude/skills"

MCP_SERVERS = {
    "anvil": {"type": "http", "url": "http://localhost:8100/mcp"},
    "vault": {"type": "http", "url": "http://localhost:8300/mcp"},
    "forge": {"type": "http", "url": "http://localhost:8200/mcp"},
}

# ── helpers ───────────────────────────────────────────────────────────────────

def ok(msg):  print(f"  ✓ {msg}")
def info(msg): print(f"  → {msg}")
def warn(msg): print(f"  ⚠ {msg}")

def patch_file(path: Path, old: str, new: str, label: str):
    content = path.read_text()
    if old not in content:
        warn(f"{label}: patch target not found (already applied or skill changed)")
        return
    path.write_text(content.replace(old, new, 1))
    ok(label)

# ── step 1: remove guard hooks from benchy settings.local.json ───────────────

def fix_local_settings():
    print("\n[1] Removing guard hooks from benchy settings.local.json")
    if not LOCAL_CFG.exists():
        warn("settings.local.json not found — skipping")
        return

    data = json.loads(LOCAL_CFG.read_text())

    if "hooks" not in data:
        ok("No hooks present (already clean)")
    else:
        del data["hooks"]
        LOCAL_CFG.write_text(json.dumps(data, indent=2) + "\n")
        ok("Removed hooks key")

    # Ensure MCP is present
    data.setdefault("mcpServers", {}).update(MCP_SERVERS)
    LOCAL_CFG.write_text(json.dumps(data, indent=2) + "\n")
    ok("MCP servers present in local settings")

# ── step 2: add MCP to global ~/.claude/settings.json ────────────────────────

def fix_global_settings():
    print("\n[2] Adding MCP servers to global ~/.claude/settings.json")
    data = json.loads(GLOBAL_CFG.read_text()) if GLOBAL_CFG.exists() else {}
    existing = data.get("mcpServers", {})

    if all(k in existing for k in MCP_SERVERS):
        ok("MCP servers already present")
        return

    data.setdefault("mcpServers", {}).update(MCP_SERVERS)
    GLOBAL_CFG.write_text(json.dumps(data, indent=2) + "\n")
    ok("MCP servers added")

# ── step 3: copy skills from benchy → global ─────────────────────────────────

SKILL_PREFIXES = ("sdlc-", "forge-create", "index-claude-code-docs")

def copy_skills():
    print("\n[3] Copying SDLC skills to ~/.claude/skills/")
    if not BENCHY_SKILLS.exists():
        warn(f"Benchy skills dir not found at {BENCHY_SKILLS} — skipping copy")
        return

    GLOBAL_SKILLS.mkdir(parents=True, exist_ok=True)
    copied = 0
    for skill_dir in BENCHY_SKILLS.iterdir():
        if any(skill_dir.name.startswith(p) for p in SKILL_PREFIXES):
            dest = GLOBAL_SKILLS / skill_dir.name
            shutil.copytree(skill_dir, dest, dirs_exist_ok=True)
            copied += 1

    ok(f"Copied {copied} skill directories")

# ── step 4: patch sdlc-developer ─────────────────────────────────────────────

def patch_developer():
    print("\n[4] Patching sdlc-developer")
    skill = GLOBAL_SKILLS / "sdlc-developer/SKILL.md"
    if not skill.exists():
        warn("sdlc-developer/SKILL.md not found")
        return

    patches = [
        (
            "  Deterministic git operations (branching, committing) are handled by scripts bundled inside the\n"
            "  session path returned by forge_develop.",
            "  Git operations (branching, committing) are performed directly in the checked-out repo using\n"
            "  standard git commands. forge_develop is not used during this transitional period.",
            "description: remove forge_develop mention",
        ),
        (
            "| `forge_workspace_create` | Create managed workspace (plugins, MCP configs, env vars) |\n"
            "| `forge_workspace_list` | Check for existing workspaces |\n"
            "| `forge_develop` | Create or resume an isolated code session (git worktree) for a repo + work item |\n"
            "| `forge_repo_list` | Discover repos in the local index |",
            "| `forge_repo_list` | Discover repos in the local index |",
            "tools-table: remove workspace/session tools",
        ),
        (
            "## Scripts (in session path)\n"
            "\n"
            "When `forge_develop` creates or resumes a session, it installs enforcement scripts into the session's `.forge/scripts/` directory. Always use these — they read workflow metadata automatically and do the right thing for every workflow type (owner, fork, contributor).\n"
            "\n"
            "| Script | Purpose |\n"
            "|--------|---------|\n"
            "| `.forge/scripts/commit.sh` | Commit staged changes as a conventional commit: `<type>(<scope>): <description>` |\n"
            "| `.forge/scripts/push.sh` | Push current branch to the correct remote for this repo's workflow |\n"
            "| `.forge/scripts/create-pr.sh` | Create a PR against the correct target (handles fork vs owner vs contributor) |\n"
            "\n"
            "**The SKILL.md decides WHEN to call scripts. Scripts handle the mechanical execution.**\n"
            "\n"
            "## Code Access Constraints\n"
            "\n"
            "**Investigation reads:** When examining code before or during implementation (e.g., reading related modules, checking call sites), read from the session path if you have an active session, or from the managed clone pool via `forge_repo_resolve`. Never read from the host-mounted source repos — they may be stale.\n"
            "\n"
            "**Subagent investigation:** If you delegate code exploration to a subagent, provide the session path or managed clone path explicitly. Do not let subagents resolve paths independently.\n"
            "\n"
            "**Vault context:** Always load Vault context via `knowledge_resolve_context` before reading source files. Vault may already contain the architectural understanding you need.",
            "## Git Operations (direct)\n"
            "\n"
            "During this transitional period, use standard git commands directly in the repo — no forge scripts.\n"
            "\n"
            "| Operation | Command |\n"
            "|-----------|---------|\n"
            "| Create branch | `git checkout -b <type>/<id>-<slug>` |\n"
            "| Resume branch | `git checkout <branch-name>` |\n"
            "| Commit | `git add <files> && git commit -m \"<type>(<scope>): <description>\"` |\n"
            "| Push | `git push -u origin <branch-name>` |\n"
            "| Create PR | `gh pr create --title \"...\" --body \"...\"` |\n"
            "\n"
            "## Code Access Constraints\n"
            "\n"
            "**Investigation reads:** Read directly from the checked-out repo (CWD). Always confirm via `pwd` + `git remote -v` that you're in the right repo before reading or writing.\n"
            "\n"
            "**Subagent investigation:** Provide the absolute repo path explicitly to subagents.\n"
            "\n"
            "**Vault context:** Always load Vault context via `knowledge_resolve_context` before reading source files. Vault may already contain the architectural understanding you need.",
            "scripts+code-access: replace with direct git ops",
        ),
        (
            "After receiving the briefing: if the work item has a `repo` field set, use that as the primary repo for `forge_develop`. If not, fall back to repos listed in the project note.",
            "After receiving the briefing: if the work item has a `repo` field set, use that as the primary repo. If not, fall back to repos listed in the project note. Confirm with the user which local checkout to use if ambiguous.",
            "phase1: remove forge_develop reference",
        ),
        (
            "### Phase 4: Bootstrap Workspace and Start Code Session\n"
            "\n"
            "**Workspace bootstrap (once per work item):**\n"
            "\n"
            "If no workspace exists:\n"
            "1. Call `forge_workspace_create` with the project's workspace config — sets up plugins, MCP configs, and `workspace.env`\n"
            "\n"
            "If a workspace exists (resume):\n"
            "1. Check state via `forge_workspace_list`\n"
            "2. Reuse existing workspace\n"
            "\n"
            "**Starting a code session (every time you need to touch a repo):**\n"
            "\n"
            "Code sessions are isolated git worktrees created on-demand. Whenever you need to make code changes to a repo:\n"
            "\n"
            "1. Call `forge_repo_list` to verify the repo exists in the index\n"
            "2. Derive the feature branch name from the work item:\n"
            "   - Pattern: `<subtype>/<id>-<slug>` where `subtype` comes from the work item's `type` field (e.g. `bugfix`, `feature`, `refactor`) and `slug` is a short kebab-case summary of the title\n"
            "   - Example: work item `{ id: \"5e815a8d\", type: \"bugfix\", title: \"Fix developer branching\" }` → `bugfix/5e815a8d-fix-developer-branching`\n"
            "3. Call `forge_develop` with:\n"
            "   - `repo`: the repo name from the index\n"
            "   - `workItem`: the work item ID (e.g. `\"9faec02d\"` or the full UUID)\n"
            "   - `branch`: the derived feature branch name (always pass this — never omit it)\n"
            "4. **Handle the response:**\n"
            "   - `status: \"created\"` → new session on the feature branch; proceed with implementation\n"
            "   - `status: \"resumed\"` → existing session already on the correct branch; skip branch setup and continue from where the session left off\n"
            "   - `status: \"needs_workflow_confirmation\"` → see workflow confirmation flow below\n"
            "5. **All code changes go into `sessionPath`**. Never write directly to the repo's source path.\n"
            "\n"
            "**Workflow confirmation flow:**\n"
            "\n"
            "When `forge_develop` returns `status: \"needs_workflow_confirmation\"`:\n"
            "1. The response includes a `detected` object with auto-detected workflow values (type, upstream, fork remote, etc.)\n"
            "2. Present the detected values to the user: \"No workflow is saved for `{repo}`. Detected: `{type}` workflow. Is this correct?\"\n"
            "3. On user confirmation (or correction), re-call `forge_develop` with the same `repo` + `workItem` plus a `workflow` parameter:\n"
            "   ```\n"
            "   forge_develop({ repo: \"my-repo\", workItem: \"WI-42\",\n"
            "                   workflow: { type: \"fork\", upstream: \"git@github.com:org/repo.git\" } })\n"
            "   ```\n"
            "4. This second call saves the workflow and creates the session in one shot — response will be `status: \"created\"`.\n"
            "5. Subsequent calls for the same repo need no `workflow` parameter.\n"
            "\n"
            "This is a one-time cost per repo. All future work items on the same repo skip this step.",
            "### Phase 4: Set Up Code Session (Direct Git)\n"
            "\n"
            "> **Transitional mode:** `forge_develop` is not in use. Work directly in the checked-out repo.\n"
            "\n"
            "1. **Confirm the working directory.** Run `pwd` and `git remote -v` to verify you're in the correct repo. If the user hasn't cd'd to the repo yet, ask them to do so before continuing.\n"
            "\n"
            "2. **Derive the feature branch name** from the work item:\n"
            "   - Pattern: `<subtype>/<id>-<slug>` where `subtype` comes from the work item type (e.g. `bugfix`, `feature`, `refactor`) and `slug` is a short kebab-case summary of the title\n"
            "   - Example: `bugfix/5e815a8d-fix-developer-branching`\n"
            "\n"
            "3. **Create or resume the branch:**\n"
            "   - New work: `git checkout -b <branch-name>`\n"
            "   - Resuming: `git checkout <branch-name>` (branch already exists)\n"
            "\n"
            "4. **All code changes go into the current repo directory** at their actual file paths.",
            "phase4: replace forge_develop session flow with direct git",
        ),
        (
            "1. **Invoke the `sdlc-tester` skill** (v2.x rewritten orchestration skill) against this work item in **spec-generation / RED mode**. Pass the work item ID, the active `sessionPath`, and the acceptance criteria.",
            "1. **Invoke the `sdlc-tester` skill** (v2.x rewritten orchestration skill) against this work item in **spec-generation / RED mode**. Pass the work item ID and the acceptance criteria.",
            "phase4b: remove sessionPath from tester call",
        ),
        (
            "1. **Implement the changes** in `sessionPath` following conventions from Vault\n"
            "2. **Update plan progress** via `anvil_update_entity`:\n"
            "   - Current step: ✅ done → 🔄 in progress → ⬜ pending\n"
            "3. **Commit** using conventional commit format:\n"
            "   - Stage changes, then run `.forge/scripts/commit.sh <type> <scope> <description>` inside `sessionPath`\n"
            "   - Example: `.forge/scripts/commit.sh feat forge \"add commit.sh to session scripts\"`\n"
            "   - One commit per logical change",
            "1. **Implement the changes** in the repo (CWD) following conventions from Vault\n"
            "2. **Update plan progress** via `anvil_update_entity`:\n"
            "   - Current step: ✅ done → 🔄 in progress → ⬜ pending\n"
            "3. **Commit** using conventional commit format:\n"
            "   - `git add <files> && git commit -m \"<type>(<scope>): <description>\"`\n"
            "   - Example: `git commit -m \"feat(forge): add commit helper to session scripts\"`\n"
            "   - One commit per logical change",
            "phase5: replace sessionPath + forge scripts with direct git",
        ),
        (
            "1. **Invoke the `sdlc-tester` skill at the green gate.** Pass the work item ID and the active `sessionPath`.",
            "1. **Invoke the `sdlc-tester` skill at the green gate.** Pass the work item ID.",
            "phase7: remove sessionPath from tester call",
        ),
        (
            "### Flow 11: Multi-Repo\n"
            "- Project declares multiple repos\n"
            "- Call `forge_develop` once per repo needed\n"
            "- Plan identifies which changes go where\n"
            "- Separate branches and commits per repo\n"
            "- Cross-linked PRs",
            "### Flow 11: Multi-Repo\n"
            "- Project declares multiple repos\n"
            "- User must have each repo checked out locally\n"
            "- Plan identifies which changes go where\n"
            "- Create feature branch in each repo separately (same branch name pattern)\n"
            "- Separate commits per repo, cross-linked PRs",
            "flow11: remove forge_develop",
        ),
    ]

    for old, new, label in patches:
        patch_file(skill, old, new, label)

# ── step 5: patch sdlc-orchestrator ──────────────────────────────────────────

def patch_orchestrator():
    print("\n[5] Patching sdlc-orchestrator")
    skill = GLOBAL_SKILLS / "sdlc-orchestrator/SKILL.md"
    if not skill.exists():
        warn("sdlc-orchestrator/SKILL.md not found")
        return

    patches = [
        (
            "| `forge_session_list` | List active code sessions across repos and work items |\n"
            "| `forge_session_cleanup` | Clean up stale or completed sessions |",
            "",
            "tools-table: remove session tools",
        ),
        (
            "### `clean` — Cleanup Scan (Flow 24)\n"
            "\n"
            "Scan for cleanup candidates across work items, workspaces, and code sessions:\n"
            "\n"
            "1. `anvil_search` for `draft` work items older than 30 days → suggest cancel or promote\n"
            "2. `anvil_search` for `blocked` work items older than 14 days → suggest re-evaluate\n"
            "3. `anvil_search` for completed spikes with no follow-up work items\n"
            "4. `forge_workspace_list` for stale workspaces → suggest clean\n"
            "5. **Session cleanup:** Call `forge_session_cleanup({ auto: true })`:\n"
            "   - Automatically identifies sessions whose linked work items are `done` or `cancelled`\n"
            "   - Removes the git worktree and session record for each eligible session\n"
            "   - Returns a summary of what was cleaned and what was skipped (with reasons)\n"
            "6. **Surface stale sessions:** Call `forge_session_list` to show any remaining sessions older than 14 days with no recent activity — present for manual review\n"
            "7. Present combined cleanup plan (work items + workspaces + sessions) for human approval",
            "### `clean` — Cleanup Scan (Flow 24)\n"
            "\n"
            "Scan for cleanup candidates across work items:\n"
            "\n"
            "1. `anvil_search` for `draft` work items older than 30 days → suggest cancel or promote\n"
            "2. `anvil_search` for `blocked` work items older than 14 days → suggest re-evaluate\n"
            "3. `anvil_search` for completed spikes with no follow-up work items\n"
            "4. Present cleanup plan for human approval",
            "clean: remove workspace/session cleanup steps",
        ),
        (
            "1. **Check conversation-state first.** If the conversation-state (loaded during bootstrap) has `work_items` linked, use those directly — skip the Anvil search in step 2.\n"
            "2. **Otherwise,** `anvil_search` for work items with `status: in_progress`.\n"
            "3. For each, query related plans via `anvil_search` with type `plan`\n"
            "4. Read plan to find which steps are done (✅), in progress (🔄), pending (⬜)\n"
            "5. Read recent journal entries for the work item\n"
            "6. Check `forge_workspace_list` for existing workspaces linked to this work item\n"
            "7. Check `forge_session_list` for existing code sessions linked to this work item\n"
            "8. Present summary: \"You were working on #{id} '{title}'. Steps 1-3 done. Step 4 is next. Session exists at `{sessionPath}`. Ready to continue?\"\n"
            "9. Hand off to developer skill with full context loaded",
            "1. **Check conversation-state first.** If the conversation-state (loaded during bootstrap) has `work_items` linked, use those directly — skip the Anvil search in step 2.\n"
            "2. **Otherwise,** `anvil_search` for work items with `status: in_progress`.\n"
            "3. For each, query related plans via `anvil_search` with type `plan`\n"
            "4. Read plan to find which steps are done (✅), in progress (🔄), pending (⬜)\n"
            "5. Read recent journal entries for the work item\n"
            "6. Present summary: \"You were working on #{id} '{title}'. Steps 1-3 done. Step 4 is next. Make sure you're cd'd into the repo, then ready to continue?\"\n"
            "7. Hand off to developer skill with full context loaded",
            "resume: remove forge_session_list/workspace_list steps",
        ),
    ]

    for old, new, label in patches:
        patch_file(skill, old, new, label)

# ── step 6: rewrite horus-forge ──────────────────────────────────────────────

HORUS_FORGE_CONTENT = """\
---
name: horus-forge
description: >
  Forge MCP reference. Use when you need to discover repos (forge_repo_list,
  forge_repo_scan), resolve git workflow config (forge_repo_workflow), or
  manage the artifact registry (search, add, install, publish).
  forge_develop, forge_repo_resolve, and all workspace/session tools are
  disabled during the current transitional period — do NOT call them.
---

# Horus Forge — MCP Tool Reference (Transitional Mode)

> **Transitional period:** `forge_develop`, `forge_repo_resolve`, all workspace tools
> (`forge_workspace_*`), and all session tools (`forge_session_*`) are **disabled**.
> Work directly in the checked-out repo. The user will `cd` to the repo and launch
> Claude from there. Do not attempt to create sessions, resolve repos via Forge, or
> create/list/delete workspaces.

## Active Tools

| Tool | Category | Purpose | Key Parameters |
|------|----------|---------|---------------|
| `forge_search` | Registry | Search registries for artifacts | `query` (required), `type` filter |
| `forge_resolve` | Registry | Inspect a single artifact + deps | `ref` (e.g., `"plugin:anvil-sdlc-v2"`) |
| `forge_add` | Registry | Add artifact refs to forge.yaml | `refs` (array, e.g., `["skill:developer@1.0.0"]`) |
| `forge_install` | Registry | Install all artifacts from forge.yaml | `dryRun`, `target` (claude-code/cursor/plugin) |
| `forge_list` | Registry | List installed or available artifacts | `scope` (installed/available), type filter |
| `forge_publish` | Registry | Publish an artifact to a registry | `ref` (required), `registry` (target registry id) |
| `forge_repo_list` | Repos | List repos from local index | `query` (filter), `language` (filter) |
| `forge_repo_scan` | Repos | Trigger a full index rescan | _(none — config-driven)_ |
| `forge_repo_workflow` | Repos | Get/save git workflow config for a repo | `name` (required), `workflow` (optional, to save) |

## Disabled Tools (do not call)

| Tool | Reason |
|------|--------|
| `forge_develop` | Session/worktree creation is disabled |
| `forge_repo_resolve` | Use CWD directly — no managed clone pool |
| `forge_session_list` | No active sessions |
| `forge_session_cleanup` | No active sessions |
| `forge_workspace_create` | Workspace concept disabled |
| `forge_workspace_list` | Workspace concept disabled |
| `forge_workspace_delete` | Workspace concept disabled |
| `forge_workspace_status` | Workspace concept disabled |

## Code Access

Read and write files from the current working directory. The user is responsible for `cd`-ing into the correct repo before launching Claude. Confirm with `pwd` and `git remote -v` if unsure.

**Do not** call `forge_repo_resolve` to get a path — there is no managed clone pool in use.

## Registry Architecture

Forge resolves artifacts from an ordered list of registries defined in `forge.yaml`. The first registry with a matching artifact wins.

### Registry types

| Type | Description | Writable |
|------|-------------|---------|
| `filesystem` | Local directory (e.g., `~/Horus/data/registry/`) | Yes |
| `git` | GitHub-hosted registry repo (e.g., `Arjunkhera/Forge-Registry`) | No (read-only) |
| `http` | Cloud registry endpoint | Depends on config |

### forge.yaml structure

```yaml
registries:
  - id: local
    type: filesystem
    path: ~/Horus/data/registry/
  - id: forge-registry
    type: git
    repo: Arjunkhera/Forge-Registry
    branch: master

artifacts:
  - skill:developer@1.0.0
  - plugin:anvil-sdlc-v2
  - workspace-config:sdlc-default@^2.0.0
```

## Artifact System

### Reference format

```
type:id@version
```

Examples: `skill:developer@1.0.0`, `plugin:anvil-sdlc-v2`, `agent:sdlc-implement-story@^1.0.0`

### Artifact types

| Type | Content File | Description |
|------|-------------|-------------|
| `skill` | `SKILL.md` | Opaque markdown emitted as agent instructions |
| `agent` | `AGENT.md` | Agent definition with root skill + dependencies |
| `plugin` | `PLUGIN.md` (optional) | Bundle of skills + agents |
| `persona` | `PERSONA.md` | Character profile — sets name, tone, expertise |
| `workspace-config` | `WORKSPACE.md` (optional) | Workspace template (not in use) |

### Discovery workflow

```
1. forge_search(query)              // Find artifacts
2. forge_resolve(ref)               // Inspect metadata + dependencies
3. forge_add(refs)                  // Add to forge.yaml
4. forge_install()                  // Install to workspace
```

## Repository Discovery

```
forge_repo_list()               // All indexed repos
forge_repo_list(query: "auth")  // Filter by name/path/URL
forge_repo_scan()               // Refresh index after cloning a new repo
```

### Git workflow config

```
forge_repo_workflow(name: "my-repo")
```

| Workflow Type | Push To | PR Target |
|---------------|---------|-----------|
| `owner` | `origin` | Same repo |
| `fork` | `origin` (fork) | Upstream |
| `contributor` | `origin` | Upstream |

To save: `forge_repo_workflow(name: "my-repo", workflow: { type: "owner", ... })`

## When to Use Forge vs Direct Git

| Scenario | Use |
|----------|-----|
| Finding which repos exist locally | Forge (`forge_repo_list`) |
| Registering a newly cloned repo | Forge (`forge_repo_scan`) |
| Understanding a repo's PR workflow | Forge (`forge_repo_workflow`) |
| Installing skills or plugins | Forge (`forge_add` + `forge_install`) |
| Publishing a new artifact version | Forge (`forge_publish`) |
| Browsing available tools | Forge (`forge_search`, `forge_list`) |
| Starting work in a repo | `cd` to repo, `git checkout -b <branch>` |
| Committing changes | `git add <files> && git commit -m "..."` |
| Pushing + opening a PR | `git push -u origin <branch>` + `gh pr create` |
"""

def rewrite_horus_forge():
    print("\n[6] Rewriting horus-forge skill")
    skill = GLOBAL_SKILLS / "horus-forge/SKILL.md"
    if not skill.exists():
        warn("horus-forge/SKILL.md not found — creating directory")
        skill.parent.mkdir(parents=True, exist_ok=True)
    skill.write_text(HORUS_FORGE_CONTENT)
    ok("horus-forge/SKILL.md written")

# ── step 7: update benchy CLAUDE.md ──────────────────────────────────────────

def fix_benchy_claude_md():
    print("\n[7] Updating benchy CLAUDE.md")
    if not BENCHY_MD.exists():
        warn("benchy CLAUDE.md not found — skipping")
        return
    patch_file(
        BENCHY_MD,
        "## Code Isolation\nUse `forge_develop` to create isolated code sessions before making changes to any repository.",
        "## Code Isolation\n`forge_develop` is temporarily disabled. Work directly in the checked-out repo. `cd` to the repo directory before starting a code session.",
        "CLAUDE.md: disable forge_develop instruction",
    )

# ── main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=== SDLC Transition Bootstrap ===")

    fix_local_settings()
    fix_global_settings()
    copy_skills()
    patch_developer()
    patch_orchestrator()
    rewrite_horus_forge()
    fix_benchy_claude_md()

    print("\n=== Done. Restart Claude Code to pick up skill changes. ===\n")
