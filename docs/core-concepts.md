---
title: Horus Core Concepts
description: The mental model for Anvil, Vault, Forge, and the supporting services that make Horus work.
slug: core-concepts
tags: [concepts, architecture, onboarding, anvil, vault, forge]
schema_version: 1
keywords: [concepts, architecture, mental-model, anvil, vault, forge, neo4j, typesense, mcp, services, how-it-works, overview]
related_commands: [horus status, horus config]
sidebar_position: 2
---

# Horus Core Concepts

Horus is three primary systems (Anvil, Vault, Forge) backed by supporting services (Typesense, Neo4j, a web UI). This guide explains what each one does, why it exists as a separate service, and how they connect.

## The three primary systems

### Anvil — live state

Anvil stores your structured, **changing** data: tasks, stories, projects, journals, notes, conversation state. Every entity is a markdown file with YAML front-matter, indexed by an embedded SQLite database for fast full-text search.

Anvil has a **dynamic type system** — type definitions are YAML files, not hardcoded in the server. That means you can add new note types or extend existing ones without changing code. Claude always queries the current type schema before creating a note, so your types stay authoritative.

**Use Anvil for:** tasks, projects, meeting notes, daily journals, research notes, anything you'd put in a personal knowledge-management app.

**MCP endpoint:** `http://localhost:8100`

### Vault — durable knowledge

Vault stores your **long-lived**, structured documentation: repo profiles, architecture decisions, how-to guides, procedures, and learnings. Unlike Anvil (which tracks changing state), Vault is the place for knowledge you want to reference across sessions, weeks, and projects.

Vault is a FastAPI knowledge service backed by a git repository per vault. You can run **multiple vaults** (e.g. `personal`, `work`, `client-acme`) — each is a separate repo with its own access controls and git history. A separate `vault-router` service fans out read queries to all vaults and routes writes to the correct one by UUID.

Search is powered by both Typesense (full-text, typo-tolerant) and Neo4j (graph traversal for "what's related to what"). You get semantic-ish retrieval without a GPU or an external API.

**Use Vault for:** how does this codebase work, what conventions does that team follow, what's the decision history for this architecture choice.

**MCP endpoint:** `http://localhost:8300` (via the `vault-mcp` adapter)

### Forge — execution environment

Forge is the **workspace and session manager**. It does three distinct things:

1. **Workspaces** — isolated contexts (MCP configs, skills, permissions) for a particular line of work. A workspace doesn't clone any code; it's just the agent environment.
2. **Sessions** — git worktrees tied to a work item, created on demand via `forge_develop`. A session is where code changes actually happen.
3. **Repo index** — a scanned index of your local Git repositories, made available to Claude so it can resolve and search across them.

Forge also manages **plugins and skills** — reusable packages that install into the registry and add capabilities to your workspaces.

**Use Forge for:** starting coded work, managing isolated contexts per project, discovering which repos exist on your machine.

**MCP endpoint:** `http://localhost:8200`

## Supporting services

### Typesense

A full-text and vector search engine that runs inside the Horus stack. Both Anvil and Vault use Typesense under the hood for fast, typo-tolerant search. You don't interact with Typesense directly — it's internal plumbing exposed only inside the Docker network.

### Neo4j

A graph database for relationship-aware queries. Vault uses Neo4j to store and traverse the graph of entities and edges between knowledge pages — useful for questions like "what's related to this decision" or "walk me from this ADR to the procedures that implement it". Runs on ports **7474** (browser / HTTP) and **7687** (Bolt protocol).

### Horus UI

A React web interface at **`http://localhost:8400`** that lets you browse Anvil notes, Vault pages, and Forge workspaces without going through Claude. It's served by an Express proxy that fans requests out to Anvil, Vault MCP, and Forge over the internal Docker network. Optional — Claude works fine without it — but handy for a visual sanity check.

## How they connect

Everything runs in a single Docker Compose stack on a bridge network named `horus-net`. Claude (Desktop, Code, or Cursor) connects via the Model Context Protocol (MCP) to three endpoints on your host:

| Service | Host endpoint | Who talks to it |
|---|---|---|
| Anvil | `http://localhost:8100` | Claude, Horus UI |
| Vault MCP | `http://localhost:8300` | Claude, Horus UI |
| Forge | `http://localhost:8200` | Claude, Horus UI |

Internally, Vault MCP proxies to the `vault-router`, which fans out to each `vault` instance on ports `8001`, `8002`, etc. Anvil and Vault both query Typesense over the internal network. Forge reads repo metadata from the host filesystem via a read-only bind mount.

## Data layout

All durable state lives under your data directory (default `~/Horus/data`). On a fresh install you'll see:

```
~/Horus/data/
  notes/             Anvil notes (git repo)
  vaults/
    <name>/          Each vault is a separate git repo
  registry/          Forge plugin registry (git repo)
  workspaces/        Forge workspace directories
  sessions/          Forge session git worktrees
  repos/             Managed clone pool (created by forge_repo_clone)
  config/            Forge-managed config (forge.yaml, repos.json, workspaces.json)
  typesense-data/    Typesense index (internal)
```

User config lives at `~/Horus/config.yaml` and `~/Horus/.env`. The Docker Compose file is installed at `~/Horus/docker-compose.yml` — edit it only if you know what you're doing; `horus setup` regenerates it from the config.

## Key principles

1. **Everything is local.** All data stays on your machine. Search runs in-process. The only network traffic is to Anthropic (when Claude talks to the API) and to your own Git remotes for sync.
2. **Data is durable.** Notes, knowledge, and workspaces are files on disk backed by git. Stopping the stack or removing containers never deletes your data.
3. **Routing is automatic.** You don't pick Anvil vs Vault vs Forge — Claude reads the routing rules from the `horus-*` skills and picks the right system based on intent.
4. **Types are dynamic.** Anvil's type system is runtime-defined. New types and fields land without a code release.

## What's next

- **`horus guide getting-started`** if you haven't installed yet
- **`horus guide first-note`** to create your first Anvil entity
- **`horus guide first-workspace`** to set up your first isolated working context
- **`horus guide first-session`** to start your first isolated code session
