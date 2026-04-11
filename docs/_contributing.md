---
title: Contributing to Horus Guides
description: How to author, validate, and ship the bundled getting-started guides that ride inside the Horus CLI.
slug: contributing
tags: [meta, contributing, schema]
schema_version: 1
keywords: [contributing, schema, frontmatter, guide, authoring, validator]
related_commands: [horus help, horus guide]
sidebar_position: 0
---

# Contributing to Horus Guides

This folder (`/docs/`) is the **single source of truth** for the bundled getting-started guides that ship inside the Horus CLI and are consumed by both terminal users (`horus help`, `horus guide`) and host agents (Claude Code / Cursor) as grounding material.

Every file in this folder is part of a shared contract. Before you add, edit, or remove a guide, read this document.

> **Design reference:** this schema and contract are specified in the design proposal `7fff3764` ("Horus Help Agent + Bundled Guides") and are tracked as story `001a0d96`. Deviations from this spec require a new decision journal.

---

## Contents

1. [What lives here](#what-lives-here)
2. [How guides ship to users](#how-guides-ship-to-users)
3. [Front-matter schema](#front-matter-schema)
4. [Authoring a new guide](#authoring-a-new-guide)
5. [Topic-lookup precedence](#topic-lookup-precedence)
6. [The `index.json` contract](#the-indexjson-contract)
7. [Grounding-verification stance](#grounding-verification-stance)
8. [Future: Docusaurus compatibility](#future-docusaurus-compatibility)

---

## What lives here

| Path | Purpose |
|---|---|
| `/docs/*.md` | Guides. Each guide is one markdown file with valid front-matter (see [schema](#front-matter-schema)). |
| `/docs/_contributing.md` | This file. Meta — not shipped to end users as a guide. |
| `/docs/.schema/guide-frontmatter.schema.json` | JSON Schema for front-matter validation, consumed by the CI validator in story `8381c62a`. |

**Meta-exclusion convention:** any file whose **filename** (not slug) begins with `_` is meta — the CI build script (story `8381c62a`) filters these out *before* schema validation, and they are never copied into `packages/cli/guides/` or indexed in `index.json`. This keeps meta files out of `horus help` / `horus guide` output while still allowing them to live alongside the guides for authoring convenience.

Meta files still carry normal front-matter (schema-compliant slug) for two reasons: (1) the file acts as a working reference implementation of the schema, and (2) when the Docusaurus workstream unparks, the meta files can be optionally surfaced in the docs site if authors choose.

---

## How guides ship to users

```
/docs/*.md                           ← You author here (monorepo root)
      │
      ▼  CI: schema validate + copy + build index.json
packages/cli/guides/*.md             ← Bundled into the CLI package
packages/cli/guides/index.json       ← Retrieval index (slug, tokens, metadata)
      │
      ▼  npm publish
@arkhera30/cli                       ← End users install with `npm install -g`
      │
      ├─► `horus help <query>`       (deterministic BM25-ish retrieval)
      ├─► `horus guide <topic>`      (direct reader)
      └─► base `horus-*` skills      (host-agent grounding, read guides directly)
```

Key points:

- **You only touch `/docs/`.** Everything downstream is produced by CI.
- **No Vault, no Anvil, no network at retrieval time.** `horus help` is pure in-process retrieval.
- **No LLM runs inside the CLI.** Synthesized answers come from the host agent layer (Claude Code / Cursor) reading these same guides.
- The package tarball ships `guides/**` via `packages/cli/package.json`'s `files` glob. Users get updates automatically through `horus update` → `npm install -g`.

---

## Front-matter schema

Every guide **must** start with YAML front-matter conforming to this schema. CI fails the build on any violation of a required field; unknown fields produce warnings.

### Schema at a glance

```yaml
---
# ── Required ────────────────────────────────────────────────────
title: Getting Started with Horus
description: Install Horus, run your first setup, and open the UI.
slug: getting-started
tags: [onboarding, cli, install]
schema_version: 1

# ── Retrieval signal (field required; empty array warns) ───────
keywords: [start, begin, first-time, install, fresh, new, setup]

# ── Display / UX (rendered in `horus guide <topic>` output) ────
related_commands: [horus setup, horus up, horus doctor]

# ── Docusaurus-only (ignored by CLI retrieval, kept for compat) ─
sidebar_position: 1
---
```

### Field reference

| Field | Type | Required | Validation | Purpose |
|---|---|---|---|---|
| `title` | string | ✅ | non-empty | Human-facing title (shown by `horus guide` list, `horus help` "See also", skill prompts) |
| `description` | string | ✅ | non-empty, ≤ 140 chars recommended | One-line summary (shown in the topic index and Docusaurus sidebar) |
| `slug` | string | ✅ | kebab-case, `^[a-z0-9][a-z0-9-]*$`, globally unique in `/docs/` | Stable identifier; used by `horus guide <slug>` and to name the bundled file |
| `tags` | string[] | ✅ | ≥ 1 entry, each kebab-case | Broad categorization (e.g., `onboarding`, `anvil`, `forge`) |
| `schema_version` | integer | ✅ | currently must equal `1` | Guards against silent schema drift |
| `keywords` | string[] | ✅ (field); **empty array warns** | lowercase tokens | Retrieval signal — boosts BM25 scoring for synonyms and alt-phrasings the body doesn't contain |
| `related_commands` | string[] | ✅ (field); empty array allowed | each matches `^horus [a-z-]+( [a-z-]+)*$` | Rendered in `horus guide <topic>` output footer; invites the user to run concrete follow-ups |
| `sidebar_position` | integer | ❌ | ≥ 0 | Docusaurus-only; ignored by CLI retrieval. Kept so the schema stays Docusaurus-compatible when that workstream unparks. |

### What's explicitly **NOT** a field

These were considered during design (D4, journal `9f4a8ddc`) and **rejected**. Do not add them back without a new decision journal:

- `use-case` — subsumed by tags and keywords
- `prerequisites` — belongs in the guide body, not metadata
- `audience` — alpha ships one audience (first-time users); bifurcating early adds no value
- `cli_only` / `docs_only` — the whole point is that guides serve both surfaces. No split.

### Validation rules

| Rule | Severity | When |
|---|---|---|
| Required field missing | **fail build** | CI validator rejects the guide; PR cannot merge |
| `schema_version != 1` | **fail build** | Forces explicit migration when the schema evolves |
| `slug` collides with another guide | **fail build** | Slugs must be globally unique |
| `slug` contains invalid characters | **fail build** | Must match `^[a-z0-9][a-z0-9-]*$` |
| Unknown field present | warn | CI prints a warning but continues |
| `keywords: []` | warn | Retrieval quality degrades without keywords; CI prints a warning |
| `related_commands: []` | allowed (no warning) | Some guides legitimately have no adjacent commands |

---

## Authoring a new guide

1. **Decide on a slug.** Make it short, stable, and kebab-case. The slug becomes part of the user-facing command surface (`horus guide <slug>`). Once shipped, a slug is effectively frozen — users will memorize it. Plan accordingly.

2. **Create `/docs/<slug>.md`** with valid front-matter (copy the [schema block above](#schema-at-a-glance) as a template).

3. **Write the body.** Target **~300–800 words** for alpha guides. Long enough to be useful on its own when read cold; short enough that `horus help` can dump it into a terminal without scrolling fatigue.

4. **Include concrete commands.** Every guide should show at least one command the user can actually type. Retrieval surfaces whole-body text to the user, so code fences are your UX.

5. **Populate `keywords` thoughtfully.** These are free retrieval wins. Include:
   - Alternate phrasings ("begin", "start", "first time")
   - Synonyms ("setup" vs "install" vs "configure")
   - Question words users actually type ("how", "what", "where")
   - Typos and plurals only if very common

6. **Populate `related_commands`** with 2–4 commands the reader is most likely to want next. These are rendered after the body in `horus guide <topic>` output.

7. **Validate locally.** From the monorepo root:
   ```bash
   pnpm --filter @arkhera30/cli build
   ```
   The CI build script (story `8381c62a`) validates the schema, copies the guide into `packages/cli/guides/`, and emits a fresh `index.json`. If validation fails, the command will tell you which field and which line.

8. **Smoke-test retrieval.** After a successful build:
   ```bash
   cd packages/cli
   node dist/index.js help <a query your guide should answer>
   node dist/index.js guide <slug>
   ```
   Confirm your guide is the top-1 hit (or at least in the "See also" list) for its target queries.

9. **Check the retrieval fixture.** `packages/cli/test/fixtures/retrieval.json` (story `5719ce0e`) pins expected top-1 hits for canonical queries. If your new guide changes what should win for an existing query, update the fixture in the same PR.

10. **Open a PR.** CI runs the schema validator and the retrieval fixture test. Both must pass before merge.

---

## Topic-lookup precedence

`horus guide <topic>` and the `horus-*` skill references resolve topics in this exact order, stopping at the first match tier that returns any result:

1. **Exact slug match** — `horus guide getting-started` → `getting-started.md`
2. **Slug prefix match** — `horus guide getting` → `getting-started.md` (if unique)
3. **Title fuzzy match** — `horus guide "start here"` → `getting-started.md` (via fuse.js)
4. **Keywords match** — `horus guide begin` → `getting-started.md` (via the `keywords` front-matter)

If a tier returns multiple hits, the command prints them all and asks the user to disambiguate. If zero tiers match, it suggests `horus guide` (the list form).

**Implication for authors:** the `slug` is a hard contract. Once a slug is shipped, rename it only with a deprecation period — users and base `horus-*` skills will be referencing it.

---

## The `index.json` contract

The CI build (story `8381c62a`) emits `packages/cli/guides/index.json` — a single JSON file consumed by the `horus help` retrieval pipeline and the `horus guide` list/lookup paths.

### Shape

```json
{
  "schema_version": 1,
  "built_at": "2026-04-11T07:30:00Z",
  "guide_count": 5,
  "guides": [
    {
      "slug": "getting-started",
      "title": "Getting Started with Horus",
      "description": "Install Horus, run your first setup, and open the UI.",
      "tags": ["onboarding", "cli", "install"],
      "keywords": ["start", "begin", "first-time", "install", "fresh", "new", "setup"],
      "related_commands": ["horus setup", "horus up", "horus doctor"],
      "file": "getting-started.md",
      "tokens": ["start", "horus", "install", "..."]
    }
  ]
}
```

### Field reference

| Field | Type | Source | Purpose |
|---|---|---|---|
| `schema_version` | integer | CI (literal `1`) | Guards against reader/index drift |
| `built_at` | ISO-8601 string | CI (build timestamp) | Debugging / staleness detection |
| `guide_count` | integer | CI (`guides.length`) | Sanity check for readers |
| `guides[].slug` | string | front-matter | Primary identifier |
| `guides[].title` | string | front-matter | Display |
| `guides[].description` | string | front-matter | Display |
| `guides[].tags` | string[] | front-matter | Filtering / future faceting |
| `guides[].keywords` | string[] | front-matter | Retrieval signal (BM25 token boost) |
| `guides[].related_commands` | string[] | front-matter | Rendered in `horus guide` output |
| `guides[].file` | string | CI (`<slug>.md`) | Path relative to `packages/cli/guides/` for the reader to slurp the full body |
| `guides[].tokens` | string[] | CI (tokenized body + title + keywords) | Pre-tokenized corpus for BM25 retrieval — avoids re-tokenizing at every `horus help` invocation |

### Reader expectations

- `horus help` loads `index.json` once per invocation, runs BM25 against `guides[].tokens`, and then reads the full body from `packages/cli/guides/<file>` only for the top-1 result. Alternates in "See also" are rendered from `title` + `file` alone.
- `horus guide` loads `index.json` and uses `slug` / `title` / `keywords` for the precedence chain. Only the selected guide's body is read from disk.
- Both commands treat `index.json` as authoritative — they never re-scan the `guides/` directory at runtime.

**Backwards-compatibility rule:** once a field is in `index.json`, it may not be renamed or have its meaning changed without bumping `schema_version`. Adding new optional fields is safe.

---

## Grounding-verification stance

The Horus help system relies on host agents (Claude Code / Cursor) reading bundled guides as grounding before acting. Three facts about how that's validated:

1. **We do NOT verify host-agent grounding behavior automatically.** There is no test that asserts "Claude Code actually read `first-workspace.md` before creating a workspace." That kind of assertion would require instrumenting the host agent, which is out of scope for Horus.

2. **We DO ship grounding instructions in the base `horus-*` skills** (story `5f7ab99c`). Each of `horus-anvil`, `horus-vault`, and `horus-forge` has a "Bundled Guides" section that tells the host agent *which* guide to read and *when*. This is the contract; enforcement is the host agent's responsibility.

3. **We DO smoke-test retrieval quality** via `packages/cli/test/fixtures/retrieval.json` (story `5719ce0e`). The fixture pins canonical-query-to-top-1-slug pairs. If retrieval regresses on a known query, CI fails.

### Manual grounding smoke test

When updating guides or skill grounding instructions, run this check:

1. Start a **fresh** Claude Code session (no prior context from previous sessions).
2. Invoke the `horus-anvil` skill (or whichever subsystem you're validating).
3. Observe: does the assistant surface the bundled guide reference *before* making MCP tool calls?
4. If yes: the grounding instruction is working. If no: the skill-level instruction needs strengthening.

This is a manual check, not a CI gate. Log results in a journal entry if you're verifying a specific fix.

---

## Future: Docusaurus compatibility

A separate workstream will, at some future point, stand up a Docusaurus site for the Horus docs (tracked in design doc `b6b8e05b`, currently parked). That workstream will consume the same `/docs/` folder as its content source.

**What that means for authors here:**

- The front-matter schema is already **Docusaurus-native** — `title`, `description`, `slug`, `tags`, and `sidebar_position` are all standard Docusaurus fields. No translation layer will be needed.
- Our CLI-specific fields (`keywords`, `related_commands`, `schema_version`) will be passed through to Docusaurus as custom metadata — Docusaurus ignores unknown front-matter by default, so nothing breaks.
- When the Docusaurus workstream unparks, its first task is to verify this schema is still fully compatible and propose any additive changes. Until then, author against this spec and do not second-guess Docusaurus requirements.

---

## Questions?

- Design reference: proposal `7fff3764`
- Parent story: `001a0d96`
- Schema changes: require a new decision journal and a `schema_version` bump
- Retrieval tuning: fixture lives in `packages/cli/test/fixtures/retrieval.json`
