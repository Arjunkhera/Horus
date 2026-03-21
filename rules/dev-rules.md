# Development Rules — anvil

> Project-specific coding standards. Inherits from `.sdlc/rules/global-rules.md`.

## TypeScript Standards

- Target: ES2022, strict mode enabled
- No `any` — use `unknown` + type guards where type is genuinely unknown
- Prefer `type` over `interface` for data shapes; `interface` for extension points
- All public service methods must have JSDoc comments

## Python Standards (Embedding Service)

- Type hints required on all function signatures
- Use `pydantic` for data validation and settings management
- Async-first: use `asyncio` / `fastapi` / `httpx`

## SQLite Conventions

- All schema migrations must be numbered and idempotent: `001_initial_schema.sql`
- Use parameterized queries — never string interpolation in SQL
- Index all frontmatter fields used in view queries: `type`, `status`, `tags`, `due`, `scope.*`

## MCP Tool Conventions

- Tool names follow snake_case with `anvil_` prefix
- Input schemas defined with Zod (TypeScript)
- Errors returned as `{ error: string, code: string }` — never throw unhandled
- Every tool must have at least one integration test

## File System Conventions

- Notes root is configurable via env var `ANVIL_NOTES_DIR`
- Relative paths only in frontmatter — never store absolute paths
- File watcher debounce: 200ms before re-indexing

## Testing Standards

- Unit tests for: frontmatter parsing, filter builder, ID generation, query routing
- Integration tests for: each MCP tool, SQLite index operations, file watcher behavior
- No mocking of filesystem in integration tests — use temp directories
- Test coverage target: 80% lines for `src/services/`, 100% for `src/models/`
