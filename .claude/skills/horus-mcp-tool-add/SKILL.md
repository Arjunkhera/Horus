---
name: horus-mcp-tool-add
description: Use this skill whenever the user asks to add a new MCP tool to Horus — to Anvil, Forge, or Vault MCP. Triggers on "add an MCP tool", "expose X as a tool", "register a new anvil_/forge_/knowledge_ tool", or "make this callable from Claude". Each MCP server has a different registration convention; this skill names the exact files to edit, the schema location, the test pattern, and the cross-cutting consistency checks (Anvil tool count, schema docs in Vault).
---

# horus-mcp-tool-add

## When this skill fires

- User asks to add a new MCP tool (any of `anvil_*`, `forge_*`, `knowledge_*`).
- User asks to "expose this as an MCP tool" or "make this callable from Claude / Cursor / VS Code."
- User asks to register a new Vault REST endpoint AND wire it through Vault MCP.

## First question — which server?

The three MCP servers in Horus have different conventions. Identify which one before touching any file.

| Server | Registration | Tools | Language |
|---|---|---|---|
| **Anvil** | `packages/anvil/src/mcp/server.ts` | 25 | TypeScript, direct (server has business logic) |
| **Forge** | `packages/forge/packages/mcp-server/src/index.ts` | 17 | TypeScript, calls `@forge/core` |
| **Vault MCP** | `packages/vault-mcp/src/index.ts` | 17 | TypeScript, **proxies HTTP to Vault REST** — every Vault MCP tool maps to a Vault REST endpoint |

If the answer is Vault MCP, you have **two** edits to make: a new REST endpoint in `services/vault/src/api/routes.py` AND a new MCP tool wrapper in `packages/vault-mcp/src/index.ts`. The MCP layer is a passthrough — it cannot expose what the REST service doesn't have.

## Adding an Anvil tool

1. **Create the handler** at `packages/anvil/src/tools/<kebab-name>.ts`. Follow the shape of an existing handler (e.g. `packages/anvil/src/tools/get-edges.ts`). Export an async function that takes typed inputs and returns the result.

2. **Register the tool** in `packages/anvil/src/mcp/server.ts`:
   - Add a tool definition object with `name: "anvil_<snake_name>"`, `description`, and `inputSchema` (JSON Schema).
   - Add a case in the request handler that calls your new handler.

3. **Add a test** under `packages/anvil/src/__tests__/` or alongside the handler. Use Vitest. The convention: `<name>.test.ts`.

4. **Type registry concerns.** If your tool creates/updates entities of a new type, the type must exist in `packages/anvil/defaults/<type>.yaml` OR in user-created custom-types. You cannot create entities of types that aren't registered.

5. **Cross-package impact:** if your tool touches Typesense indexing, rebuild `@horus/search` first if you changed schema fields.

## Adding a Forge tool

1. **Add core logic** to `@forge/core` (under `packages/forge/packages/core/src/`). Follow existing module patterns — e.g. registry logic in `registry.ts`, session logic in `session-manager.ts`.

2. **Register the MCP tool** in `packages/forge/packages/mcp-server/src/index.ts`:
   - Add a tool definition to the `TOOLS` array (top of the file). Use `name: "forge_<snake_name>"`.
   - Add a case in the `CallToolRequestSchema` handler that calls into your `@forge/core` function.

3. **Build order matters.** `@forge/core` must build before `@forge/mcp-server`:
   ```
   cd packages/forge && pnpm build
   ```
   The root `pnpm build` handles ordering correctly.

4. **Two-call patterns.** If the tool needs confirmation (like `forge_repo_workflow` or `forge_develop`), follow the existing `needsConfirmation: true` / second-call-with-param pattern.

5. **Test under `__tests__/`** alongside the source files.

## Adding a Vault MCP tool

This is the two-edit case.

### Edit 1 — Vault REST endpoint (Python)

1. **Add the route** in `services/vault/src/api/routes.py`:
   ```python
   @router.post("/<endpoint>", response_model=<ResponseModel>)
   async def <handler_name>(...):
       ...
   ```
2. **Add request/response models** under `services/vault/src/api/` (or in the route file if simple).
3. **Add business logic** in `services/vault/src/layer2/`. Layer 2 is where knowledge logic lives.
4. **Test with pytest** under `services/vault/tests/`.
5. **Update the docstring** at the top of `routes.py` — the read/write/graph operation count should match. (Audit revealed this docstring is stale; fix it as part of your change.)

### Edit 2 — Vault MCP wrapper (TypeScript)

1. **Add the tool wrapper** in `packages/vault-mcp/src/index.ts`. The shape is a thin HTTP POST/GET to `<KNOWLEDGE_SERVICE_URL>/<endpoint>`. Use `name: "knowledge_<snake_name>"`.
2. **No tests in vault-mcp** — it's a pure passthrough, tested via the Python side.

### Edit 3 — Vault Router (sometimes)

If the endpoint needs special routing (fan-out vs UUID-routed vs broadcast), edit `services/vault-router/src/routes.py`. Most new endpoints follow an existing pattern; consult `guides/horus-vault-router.md` (`a692f9cb-8e44-4265-9a1c-257f23dd1b8f`) in the `vault-code` vault for the routing taxonomy.

## Consistency checks before finishing

After adding ANY new tool, do these:

1. **Update Vault docs** (in the `vault-code` vault — fetch/write by UUID, path lookups 404 for non-default vaults). The relevant per-package guide states a tool count (e.g. "Anvil — 25 tools"). Update the count and add the new tool to the table. Pages to potentially touch:
   - `repos/horus.md` (`6a4a6a28-112e-466c-bc62-0e5d72742590`) (top-level counts)
   - `concepts/horus-package-architecture.md` (`7ee9e308-58d9-4e35-9f09-48bc14a1d6fd`) (MCP layer table)
   - The specific package guide (`horus-anvil-package.md` `98cd92a6-d594-468e-b766-491d395ed633`, `horus-forge-package.md` `15fd5928-f5ef-47b9-9ba6-8bb941c75c47`, `horus-vault-mcp.md` `1507fa6a-3f1c-4977-875e-87115a4ad19b`)

2. **Run the per-package tests** (`pnpm test` for TS, `pytest` for Python).

3. **Smoke test.** After deploy, confirm the tool is discoverable:
   - Anvil: `anvil_list_types({})` works, then call your tool.
   - Forge: `forge_list({ scope: "available" })`.
   - Vault: `knowledge_get_schema({})`.

4. **Commit and PR.** You're in a `forge_develop` session; commit on the feature branch and push.

## What this skill prevents

- **Adding a Vault MCP wrapper without a backing REST endpoint** (which silently fails at request time).
- **Skipping `@forge/core` and putting business logic in the MCP wrapper** (breaks reuse with `@forge/cli` and tests).
- **Updating one count and forgetting the other docs.** Tool counts appear in 3-4 places; missing one creates the same drift this pilot was authored to fix.
- **Adding tools to the canonical clone instead of a `forge_develop` session** (blocked by the guard hook).

## Background reading

Load from the **`vault-code`** vault by UUID (path-based lookups 404 for non-default vaults): `knowledge_get_page({ id: "<uuid>", vault: "vault-code" })`.

- `guides/horus-anvil-package.md` (`98cd92a6-d594-468e-b766-491d395ed633`) — Anvil tool reference
- `guides/horus-forge-package.md` (`15fd5928-f5ef-47b9-9ba6-8bb941c75c47`) — Forge tools
- `guides/horus-vault-mcp.md` (`1507fa6a-3f1c-4977-875e-87115a4ad19b`) — Vault MCP tool ↔ REST endpoint mapping
- `guides/horus-vault-service.md` (`e9771923-9899-4e12-a545-3451a71485d9`) — Vault REST architecture (Layer 1/Layer 2)
- `guides/horus-vault-router.md` (`a692f9cb-8e44-4265-9a1c-257f23dd1b8f`) — routing rules for new endpoints
