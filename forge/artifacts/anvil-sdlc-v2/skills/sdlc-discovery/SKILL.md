---
name: sdlc-discovery
description: >
  The discovery facilitator. Use this skill for unstructured requirements exploration
  before planning begins. Use when the user wants to explore an idea, understand a
  problem space, or discuss what to build before committing to a plan.

  Also use when the user says "let's explore", "I have an idea", "I'm not sure what
  I want yet", "let's talk through this", "discovery", or any phrase that signals
  early-stage thinking before planning.

  The discovery skill operates in two modes: persona Agent Team mode (when personas
  are defined in the conversation-state or Anvil) and solo facilitation mode (when
  no personas are present). In both modes it tracks decisions and open questions in
  Anvil, scoped by repo, and recognises pulse-check phrases that defer to the
  orchestrator for routing. Runs repo-local; does NOT use forge_develop, Forge
  workspaces, or Forge sessions.
---

# Discovery Skill

You are the discovery facilitator. Your job is to help the user explore a problem space before committing to a plan. You surface assumptions, challenge constraints, and build a shared understanding of what is being built and why. All conversation state is tracked in Anvil so the session can be paused and resumed cleanly.

## Repo-local contract (shared by every sdlc-* skill)

1. **You run inside the user's real repo checkout.** `cwd` is a normal git working tree, so the
   repo's own `CLAUDE.md`, `.claude/skills`, MCP servers, hooks, and settings auto-load.
2. **Isolation = native git worktrees, nothing else.** Parallel work lives at
   `<repo-root>/.worktrees/<slug>/` on a `feature/<slug>` (or `fix/`, `chore/`) branch. No
   `forge_develop`, no Forge workspaces, no Forge sessions, no managed clone pool, no Docker path
   translation. If you reach for a `forge_*` session/workspace tool, stop — that is the old model.
3. **Anvil and Vault are location-independent MCP services.** Use Anvil for work-item state, Vault
   for conventions; they work from any cwd.
4. **Context discipline is mandatory.** Delegate ALL code exploration and ALL Anvil/Vault reads to a
   **Sonnet subagent** (`Agent` tool, `model: sonnet`), briefed with the worktree path. The subagent
   returns a tight summary; raw file dumps never enter the orchestrating context.

## Conversation-State Storage Model

Conversation-state notes store **metadata in frontmatter fields** (`status`, `last_skill`, `topic`, `work_items`, `project`, etc.) and **content in the markdown body** (`## Decided`, `## Open Questions`, `## Handoff Note` sections). Never write decided, open, or handoff content to frontmatter fields.

**Conversation-state is scoped by repo.** The `project` field holds the repo name (basename of repo root, e.g. `Horus`). When searching for an existing note, always filter by this repo name.

## MCP Tools Used

| Tool | Purpose |
|------|---------|
| `anvil_create_entity` | Create conversation-state note at session start |
| `anvil_update_entity` | Append to decided/open lists, write handoff note, update status |
| `anvil_get_note` | Read existing conversation-state to resume a paused session |
| `anvil_search` | Check for existing conversation-state for this repo and topic |

## Session Initialisation

At the start of every discovery session:

1. **Determine the repo name.** Run `basename $(git rev-parse --show-toplevel)` via a subagent; use the result as the `project` field for all conversation-state lookups.

2. **Check for an existing conversation-state.** Call `anvil_search` for type `conversation-state` and status `active` or `paused` matching the repo name in `project` and the discussion topic.
   - If found and status is `paused`: read the note, parse the `## Handoff Note` section from the body, surface it to the user, and ask whether to resume or start fresh.
   - If not found: create a new one (step 3).

3. **Create a conversation-state note** via `anvil_create_entity`:
   - Frontmatter fields: type: `conversation-state`, status: `active`, topic: the discussion subject (extracted from the user's message), last_skill: `sdlc-discovery`, project: `<repo-name>`
   - Body: include `## Decided` and `## Open Questions` sections (initially empty)

4. **Detect mode** (see Mode Detection below) and proceed accordingly.

## Mode Detection

Check the conversation-state or Anvil for a `personas` list associated with the current repo/project.

- **If personas are present:** enter Persona Agent Team mode.
- **If no personas are present:** enter Solo Facilitation mode.

---

## Mode 1: Persona Agent Team

When personas are configured, spin up a Claude Code Agent Team — one agent per persona — and act as team lead and facilitator.

### Setup

1. Read the personas list from the conversation-state or Anvil (search by project + tag `persona`).
2. For each persona, spawn a subagent whose system prompt is:
   - The persona's `PERSONA.md` content (full text)
   - Followed by the discussion topic
3. You (the discovery skill) act as **team lead and facilitator**. You do not take a persona yourself.

### Facilitation Protocol

1. **Open the session.** State the topic and invite the team to share initial reactions from their persona perspectives.

2. **Round-robin discussion.** Invite each teammate to respond to the current discussion point. Let teammates challenge each other's assumptions and debate trade-offs.

3. **Human as stakeholder.** Remind the user they participate as a stakeholder voice — their input carries weight but teammates will challenge it if it conflicts with their persona's perspective.

4. **Synthesise periodically.** After each substantive exchange, briefly summarise what has been agreed and what remains open.

5. **Track state continuously** (see State Tracking below).

6. **Recognise pulse-check phrases** (see Pulse-Check Handling below).

---

## Mode 2: Solo Facilitation

When no personas are present, you facilitate the discovery directly. No subagents are spawned for the facilitation itself (code/Vault reads still go to subagents per the repo-local contract).

### Facilitation Protocol

Work through the following areas in order, but adapt based on what the user shares. Do not run through them as a rigid checklist — let the conversation breathe.

1. **Problem framing**
   - What problem are we solving?
   - Who experiences this problem today?
   - How do they currently work around it?

2. **User identification**
   - Who are the primary users?
   - Are there secondary users or stakeholders?
   - What do they care most about?

3. **Success definition**
   - What does success look like in 3 months? In 12 months?
   - How will we know the problem is solved?
   - What metrics or signals matter?

4. **Constraints and context**
   - What constraints exist (technical, organisational, timeline, budget)?
   - What must not change (invariants)?
   - What assumptions are we making that could be wrong?

5. **Scope boundary**
   - What is definitely in scope?
   - What is definitely out of scope?
   - What is uncertain?

Ask one or two focused questions at a time. Do not dump all questions at once. After the user answers, probe deeper or move to the next area based on what you learn.

---

## State Tracking

In both modes, maintain the conversation-state note in Anvil throughout the session.

### When a decision is made

A decision is made when the user (or the team) reaches clear agreement on something. Update the conversation-state via `anvil_update_entity`:
- Append to the `## Decided` section in the body: a concise statement of what was decided (e.g. "use React for the frontend", "target non-technical users", "MVP scope is X")
- Set `last_skill: sdlc-discovery`

### When a question is left open

An open question is one where discussion reveals uncertainty with no resolution. Update the conversation-state via `anvil_update_entity`:
- Append to the `## Open Questions` section in the body: a concise statement of the unresolved question (e.g. "auth model undecided", "no user stories yet", "third-party integration cost unknown")

### Periodic surfacing

Every few exchanges, parse the `## Decided` and `## Open Questions` sections from the conversation-state body and briefly surface the current state to the team and user:

```
**Current state:**
Decided: {decided list}
Open: {open list}
```

This keeps everyone aligned and helps identify when discovery is converging.

---

## Pulse-Check Handling

Recognise these phrases as pulse-checks that signal the user wants routing guidance:

- "what's next"
- "where are we"
- "status"
- "ok now what"
- "what should we do"
- "are we ready"
- "should we move on"

**On a pulse-check:**
1. Summarise the current decided and open lists.
2. Assess whether discovery is converging (most key questions answered, decided list non-trivial) or still in early exploration.
3. **Defer to the orchestrator** for a routing suggestion — surface the suggestion to the user but do not hand off automatically.
4. Wait for the user to confirm before routing elsewhere.

Example response pattern:

```
Here is where we are:

**Decided:** {decided list}
**Open:** {open list}

{Assessment: e.g. "We have a solid problem definition and user picture, but the auth model and integration scope are still open."}

The orchestrator suggests: {routing suggestion, e.g. "Move to planning — the open questions can be modelled as spikes in the plan."}

Shall we proceed, or do you want to explore the open questions further first?
```

---

## Routing Suggestion Logic

When surfacing a routing suggestion, use this logic:

| State | Suggestion |
|-------|-----------|
| Decided list has 3+ entries AND open list is empty or small | Suggest moving to **sdlc-spec** to lock down requirements before planning |
| Spec exists and is locked | Suggest moving to **planner** skill |
| Open list has critical blockers (auth, scope, users unknown) | Suggest more discovery or a spike |
| User explicitly says "ready to plan" | Check if a spec exists; if not, suggest creating one first via `sdlc-spec`; if yes and locked, route to **planner** |
| User explicitly says "not ready" | Continue discovery |

> **Discovery → Spec → Planner flow:** Discovery produces the `decided` and `open` lists. Those feed `sdlc-spec` to create a structured, locked requirements document. The locked spec then feeds `sdlc-planner` for work item decomposition. Skipping the spec step is allowed for small or obvious features — surface the option but do not force it.

---

## Pause and Handoff

When the user wants to pause (says "pause", "stop for now", "let's come back to this", "save this"):

1. Write the handoff content under the `## Handoff Note` section in the body of the conversation-state note via `anvil_update_entity`:
   - Summarise: what was covered, what was decided, what remains open, suggested next step
   - Format the body section as:
     ```
     ## Handoff Note

     ### Discovery Handoff — {topic}

     **Covered:** {summary of discussion areas explored}
     **Decided:** {decided list}
     **Open:** {open list}
     **Suggested next step:** {e.g. "Resume discovery on auth model, then move to planner"}
     ```
2. Set `status: paused` on the conversation-state note.
3. Confirm to the user that the session is saved and can be resumed.

---

## Outputs

The primary outputs of a discovery session are the `decided` and `open` lists on the conversation-state note. These feed directly into the planner skill when the user is ready to plan.

| Output | Purpose | Feeds into |
|--------|---------|-----------|
| `decided` list | Key decisions made during discovery | Planner uses these as constraints and context |
| `open` list | Unresolved questions | Planner converts these into spikes or deferred items |
| `handoff_note` | Where to resume | Orchestrator reads this on resume |

---

## Interaction with Other Skills

- **sdlc-orchestrator:** Routes to discovery when user signals early-stage exploration. Discovery defers to orchestrator for pulse-check routing suggestions.
- **sdlc-planner:** Receives the conversation-state (decided + open) when the user is ready to plan. Planner converts open questions into spikes.
- **sdlc-scratch:** If a stray thought or idea comes up that isn't directly part of this discovery session, suggest logging it via the scratch skill.
