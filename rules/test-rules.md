# Testing Rules — anvil

> Testing requirements, framework config, and coverage targets.

## Framework

- **TypeScript**: Vitest (`npm run test`)
- **Python**: pytest + pytest-asyncio

## Test Structure

```
tests/
  unit/
    frontmatter.test.ts      # Parse/serialize YAML frontmatter
    filter-builder.test.ts   # Conversational → structured filter conversion
    id-generation.test.ts    # Note ID uniqueness and stability
    note-schema.test.ts      # Type validation and schema defaults
  integration/
    mcp-tools/
      search.test.ts
      get-note.test.ts
      create-note.test.ts
      update-note.test.ts
      query-view.test.ts
      list-types.test.ts
      get-related.test.ts
    index-service.test.ts    # SQLite index CRUD and query accuracy
    watcher.test.ts          # File watcher + debounce behavior
    git-sync.test.ts         # Push/pull and conflict resolution
```

## Coverage Targets

| Path | Line Coverage |
|------|--------------|
| `src/services/` | ≥ 80% |
| `src/models/` | 100% |
| `src/mcp/tools/` | ≥ 90% |
| `src/utils/` | ≥ 80% |

## Integration Test Rules

- Use temp directories — never touch real notes in integration tests
- Each test creates its own isolated notes directory
- Tear down temp dirs in `afterEach` — no test pollution
- MCP server tests spin up a real server instance on a random port

## CI Rules

- All tests must pass before a story can move to `in_review`
- No `test.skip` or `test.only` may be committed
- Flaky tests must be fixed immediately — do not disable them

## What Needs Testing (Priority Order)

1. Frontmatter parse/serialize round-trips (correctness of core data layer)
2. SQLite index accuracy (query results match file state)
3. Each MCP tool (the external contract)
4. File watcher debounce (correctness of live update behavior)
5. Git sync conflict resolution (critical for data integrity)
6. Conversational query resolution (fuzzy, may need snapshot tests)
