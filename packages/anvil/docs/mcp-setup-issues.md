# MCP Setup Issues & Findings

## Root Causes Preventing Anvil MCP from Loading in Claude Desktop

### 1. Missing `--vault` arg in Claude Desktop config
**Status: Fixed**

`claude_desktop_config.json` was launching the server without a vault path:
```json
"args": ["/Users/arkhera/Desktop/Repositories/Anvil/dist/index.js"]
```
Fixed by adding `--vault`:
```json
"args": [
  "/Users/arkhera/Desktop/Repositories/Anvil/dist/index.js",
  "--vault",
  "/Users/arkhera/Desktop/Repositories/Notes"
]
```

---

### 2. Vault not initialized
**Status: Fixed**

The vault directory (`/Users/arkhera/Desktop/Repositories/Notes`) was empty. Anvil requires a `.anvil/types/` directory to start. Fixed by running `initVault()` from `src/setup.ts`, which created:
- `.anvil/types/` with default type YAMLs (`task.yaml`, `note.yaml`, `journal.yaml`, etc.)
- `.anvil/.local/` for the SQLite index and state
- `.anvil/config.yaml`
- `.gitignore` entry for `.anvil/.local/`

There is no `anvil init` CLI command yet — this should be added as an enhancement.

---

### 3. `better-sqlite3` native binary mismatch
**Status: Unresolved — enhancement needed**

The prebuilt `.node` binary was compiled against Node MODULE_VERSION 127, but the runtime (Node v22.22.0) requires MODULE_VERSION 137. Attempting to rebuild failed due to two compounding issues:

- **Multi-version Node conflict:** `node-gyp` kept resolving to the Homebrew-installed Node v24.9.0 instead of the nvm Node v22.22.0, even when invoking nvm's npm directly.
- **C++ header not found:** Compilation failed with `fatal error: 'climits' file not found` — a macOS SDK path issue on Darwin 25.2.0.

---

## Recommended Fixes (Enhancement)

### Option A: Docker / devcontainer
Build native dependencies inside a consistent Linux environment. Ships a working binary regardless of host Node version. Eliminates the multi-version conflict entirely.

### Option B: HTTP transport for the MCP server
Run Anvil as a persistent HTTP server process (separate from Claude Desktop). Claude Desktop connects to it over HTTP rather than spawning the process directly. This avoids native binary issues since the server can run in a controlled environment (Docker, a VM, etc.).

### Option C: Pin a single Node version system-wide
Remove Homebrew's Node installation and use only nvm. This prevents `node-gyp` from resolving the wrong Node binary during native builds.
```bash
brew uninstall node
```

---

## Environment at Time of Investigation
- macOS Darwin 25.2.0 (arm64)
- nvm Node: v22.22.0
- Homebrew Node: v24.9.0 (conflict source)
- `better-sqlite3`: v11.10.0
