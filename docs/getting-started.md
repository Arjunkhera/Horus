---
title: Getting Started with Horus
description: Install the Horus CLI, run first setup, and connect Claude — typically under ten minutes.
slug: getting-started
tags: [onboarding, cli, install, setup]
schema_version: 1
keywords: [start, begin, first-time, install, setup, fresh, new, quickstart, onboarding, initialize]
related_commands: [horus setup, horus status, horus connect, horus doctor]
sidebar_position: 1
---

# Getting Started with Horus

Horus is a local-first AI development environment. It runs Anvil (notes), Vault (knowledge), and Forge (workspaces) as containers on your machine, and connects Claude to them so your sessions have durable memory and structured workflows.

This guide takes you from "nothing installed" to "asking Claude questions about your data" in about ten minutes.

## Prerequisites

- **Docker 24+** or **Podman 4+** with the Compose plugin
- **Node.js 18+** (for installing the CLI via `npm`)
- **Claude Desktop**, **Claude Code**, or **Cursor** installed
- **Git repositories to store your data.** You'll need URLs for:
  - One repository for Anvil notes (e.g. `horus-notes`)
  - One repository per Vault knowledge base (e.g. `my-vault`)
  - One repository for the Forge registry (e.g. `forge-registry`)

Empty repos are fine — Horus clones them on first boot. Use HTTPS URLs, not SSH, because containers don't have your SSH keys. A GitHub token is required for private repositories.

## 1. Install the CLI

```bash
npm install -g @arkhera30/cli
horus --version
```

The CLI is published to npm as `@arkhera30/cli` and installs a single binary named `horus`.

## 2. Run setup

```bash
horus setup
```

The setup wizard walks you through everything. Expect prompts for:

- **Container runtime** — Docker or Podman, whichever is installed
- **Data directory** — where Horus stores notes, knowledge, and workspaces. Default: `~/Horus/data`
- **Host repos path** — the directory containing your local Git repositories. Forge indexes this read-only so you can ask Claude about your codebases
- **Repository URLs** — your Anvil notes repo, one or more Vault knowledge repos, and the Forge registry
- **GitHub tokens** — one per Git server hostname (only needed for private repos)

Setup then:

1. Writes config to `~/Horus/config.yaml` and `~/Horus/.env`
2. Installs a generated `~/Horus/docker-compose.yml`
3. Clones your repositories into the data directory
4. Pulls container images and starts the stack
5. Waits for every service to report healthy
6. Automatically runs `horus connect` for any detected AI clients

When setup finishes you'll see a summary with service URLs and your configured vault instances.

## 3. Verify the stack is healthy

```bash
horus status
```

You should see every service reporting `healthy`, with the Anvil, Vault Router, Vault MCP, Forge, Neo4j, Typesense, and Horus UI containers running. If any service is unhealthy, run `horus doctor` for diagnostics.

## 4. Open the Horus UI (optional)

Horus ships with a web UI at **`http://localhost:8400`** that you can use to browse notes, knowledge pages, and workspaces without going through Claude. Useful for a quick visual check that things are working.

## 5. Ask Claude something

Restart Claude Desktop, Claude Code, or Cursor so it picks up the new MCP servers that `horus connect` configured. Then try these prompts:

- **Anvil** — `"What's pending?"` — Claude routes this to Anvil, which searches your notes for open tasks.
- **Anvil** — `"Create a project called My App"` — Anvil creates a typed project note.
- **Vault** — `"How does the auth module work?"` — Claude routes to Vault's semantic search over your knowledge base.
- **Forge** — `"List my workspaces"` — Forge returns workspace records (empty on first run — that's expected).

Your Anvil and Vault repositories are empty on first install, so queries return nothing until you start creating notes and writing knowledge pages. That is normal and expected for a fresh install.

## What to read next

- **`horus guide core-concepts`** — the mental model for Anvil, Vault, Forge, and the supporting services
- **`horus guide first-workspace`** — how to set up an isolated context for working on a project
- **`horus guide first-session`** — how to start an isolated code session tied to a work item
- **`horus guide first-note`** — how Anvil's dynamic type system works and how to create your first note

If anything goes wrong during setup, `horus doctor` runs a full diagnostic and tells you exactly what to fix.
