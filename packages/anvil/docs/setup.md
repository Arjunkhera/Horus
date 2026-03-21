# Anvil Setup Guide

This guide walks you through installing Anvil and configuring it with Claude Desktop (or other MCP clients).

## Prerequisites

- Node.js 18 or later
- npm or yarn
- Claude Desktop app (for MCP integration) or another MCP client
- A markdown vault directory (can be empty to start)

## Installation

1. **Clone or download Anvil**:
   ```bash
   git clone <repository-url>
   cd anvil
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Build the project**:
   ```bash
   npm run build
   ```

   This compiles TypeScript to JavaScript in the `dist/` directory.

## Configuration

### Claude Desktop Setup

1. **Locate your Claude Desktop config**:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   - **Linux**: `~/.config/Claude/claude_desktop_config.json`

2. **Add Anvil to your MCP servers**:
   ```json
   {
     "mcpServers": {
       "anvil": {
         "command": "node",
         "args": ["/path/to/anvil/dist/index.js"],
         "env": {
           "VAULT_PATH": "/path/to/your/vault"
         }
       }
     }
   }
   ```

   Replace:
   - `/path/to/anvil` with your actual Anvil directory
   - `/path/to/your/vault` with your markdown vault directory (create one if needed)

3. **Restart Claude Desktop** for the changes to take effect.

### Other MCP Clients

If using another MCP client, configure it to run:
```bash
node /path/to/anvil/dist/index.js
```

With environment variable:
```
VAULT_PATH=/path/to/your/vault
```

## Your First Note

Once configured, you can create notes directly in Claude:

```
User: Create a new task about implementing user authentication.

Claude: I'll create a task for you.
[Uses anvil_create_note tool]
```

The note will be:
1. Validated against the task type schema
2. Written to `{VAULT_PATH}/tasks/implement-user-authentication.md`
3. Indexed in the SQLite database

### Example Output

```markdown
---
noteId: 550e8400-e29b-41d4-a716-446655440001
type: task
title: "Implement User Authentication"
status: open
priority: P2-medium
created: "2026-02-15T10:30:00Z"
modified: "2026-02-15T10:30:00Z"
tags: []
---

## Context

## Acceptance Criteria

- [ ]

## Notes
```

## Using Built-in Types

Anvil comes with several default types. You can create notes using any of them:

- **task**: Actionable items with status, priority, due date, effort
- **project**: Larger initiatives with status and milestones
- **note**: General information storage
- **meeting**: Meeting notes with attendees and action items
- **journal**: Daily logs with append-only behavior
- **person**: Team member profiles
- **story**: User stories and features
- **service**: External services and APIs
- **_core**: Base type with common fields (inherited by others)

## Creating a Custom Type

1. Create a `.yaml` file in your vault's types directory:
   ```yaml
   # types/bug.yaml
   id: bug
   name: Bug Report
   extends: task
   fields:
     severity:
       type: enum
       values: [critical, high, medium, low]
       required: true
     environment:
       type: string
       required: true
   template:
     frontmatter:
       status: open
       priority: P1-high
     body: |
       ## Description
       
       ## Steps to Reproduce
       
       ## Expected Behavior
       
       ## Actual Behavior
   ```

2. Restart Anvil to load the new type.

3. Create a bug note:
   ```
   User: Create a bug for the login page not loading.
   ```

See [Type Authoring Guide](types.md) for details.

## Vault Organization

Your vault is organized into directories by note type:

```
/path/to/your/vault/
├── tasks/
│   ├── implement-auth.md
│   └── write-tests.md
├── projects/
│   └── website-redesign.md
├── people/
│   ├── alice-smith.md
│   └── bob-jones.md
├── notes/
│   └── architecture-decisions.md
├── journals/
│   └── daily-2026-02-15.md
└── stories/
    └── user-authentication.md
```

Each file contains:
- **Frontmatter** (YAML): Type, status, tags, dates, custom fields
- **Body**: Markdown content (supports wiki-links like `[[Note Title]]`)

## Searching Your Notes

Use the `anvil_search` tool to find notes:

```
User: Find all open tasks about authentication.

Claude: I'll search your vault.
[Uses anvil_search tool with filters: type=task, status=open, query=authentication]
```

## Querying Views

Create custom views of your notes:

```
User: Show me a kanban board of all tasks grouped by status.

Claude: I'll create a board view for you.
[Uses anvil_query_view tool with type=board, group_by=status]
```

Supported view types:
- **list**: Simple list with pagination
- **table**: Tabular view with custom columns
- **board**: Kanban-style grouped view

## Git Integration

If your vault is a git repository, you can sync with remote:

```
User: Pull the latest notes from git.

Claude: I'll sync your vault.
[Uses anvil_sync_pull tool]
```

Supported operations:
- `anvil_sync_pull`: Fetch changes from remote
- `anvil_sync_push`: Push local changes to remote

## Troubleshooting

### "Cannot find module" error
Ensure you've run `npm run build` to compile TypeScript.

### "Type not found" error
Make sure your type's `.yaml` file is in the vault's types directory and Anvil has been restarted.

### Notes not appearing in search
The notes must:
1. Have valid frontmatter (valid YAML)
2. Reference a type that exists
3. Be in the correct vault directory

Check the database with SQLite:
```bash
sqlite3 <vault-path>/.anvil/index.db ".tables"
```

### File not found errors
Check that `VAULT_PATH` environment variable is correctly set and the directory exists.

## Next Steps

- **[MCP Tools Reference](tools.md)**: Learn about all available tools
- **[Type Authoring Guide](types.md)**: Create custom note types
- **Main [README](../README.md)**: Project overview

## Support

For issues or questions:
1. Check the [troubleshooting section](#troubleshooting)
2. Review test files in `tests/` for usage examples
3. Examine the source code in `src/` for implementation details
