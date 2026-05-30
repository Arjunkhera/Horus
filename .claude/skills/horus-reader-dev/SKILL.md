---
name: horus-reader-dev
description: Use this skill before making any change to the Horus Reader (packages/horus-ui-client/). Fires when the user asks to add a type, fix a UI bug, add a page, change styling, or extend the Reader in any way. Covers the no-bundler architecture, file responsibilities, script load order, type display system, and the forge_develop workflow.
---

# horus-reader-dev

## When to use this skill

- Adding or changing a UI element in the Reader
- Adding a new Anvil type that should appear in the sidebar / home / search
- Fixing a visual bug in the Reader
- Adding a new page or route
- Changing theme colors or CSS variables
- Any edit to `packages/horus-ui-client/` files

## Architecture in one paragraph

The Reader is a **no-bundler SPA**: React 18 UMD + Babel Standalone load from CDN; `.jsx` files are transpiled in-browser by Babel. There are no `import`/`export` statements — all cross-file state lives on `window.*` globals. `index.html` controls load order. nginx serves the static files at port 8400 and proxies `/api` → Anvil at port 8100.

## File responsibilities

| File | Responsibility |
|------|---------------|
| `app.jsx` | Root component, routing (in-memory history stack), keyboard shortcuts, tweaks state |
| `pages.jsx` | **Everything visible**: Sidebar, HomePage, NotePage, TagPage, TypePage, SearchPalette |
| `styles.css` | All CSS + CSS custom properties (theming, type colors) |
| `data.js` | In-memory note store — `window.HORUS_DATA`; `typeCounts()`, `tagCounts()`, `search()` |
| `hooks.js` | SSE real-time sync, Anvil API calls |
| `md.jsx` | Markdown renderer with `[[wiki-link]]` resolution |
| `tweaks-panel.jsx` | Floating settings panel (theme / density / accent) |
| `icons.jsx` | SVG icon set — `window.Icon.*` |
| `anvil-client.js` | Anvil HTTP API client |
| `index.html` | Script load order — **do not reorder** |

## Script load order (must not change)

```
tweaks-panel.jsx
data.js           → window.HORUS_DATA
anvil-client.js
hooks.js
icons.jsx         → window.Icon
md.jsx
pages.jsx
app.jsx           → calls ReactDOM.createRoot()
```

## Type display system

Types in sidebar, home tiles, and search palette are **fully dynamic** — driven by live `typeCounts()`. No hardcoded list.

- `TYPE_ORDER` (`pages.jsx`) — priority order for known types
- `activeTypes(counts)` — all types with ≥1 note; TYPE_ORDER first, extras by count

### Recipe: add a new Anvil type

1. **`pages.jsx`** — insert into `TYPE_ORDER`
2. **`styles.css` `:root`** — add `--type-your-type: oklch(0.72 0.10 <hue>);` (pick unused hue)
3. **`styles.css` `[data-theme="light"]`** — add same var at lower lightness (~0.45)
4. **`styles.css`** — add `.type-dot.your-type { background: var(--type-your-type); }`

Types without a dot rule still appear with `--fg-3` fallback.

## Route system

Client-side history stack in `app.jsx`. Four kinds:

| `kind` | Renders |
|--------|---------|
| `home` | `HomePage` |
| `note` | `NotePage` |
| `tag` | `TagPage` |
| `type` | `TypePage` |

To add a route: create a component in `pages.jsx`, add a branch in `app.jsx`, update the `crumb` string.

## Dev workflow

> ⚠️ The workspace guard hook blocks direct edits to source repos. Always use `forge_develop`.

```
forge_develop(repo: "Horus", workItem: "<work-item-id>")
→ edit sessionPath/packages/horus-ui-client/
→ commit + push + gh pr create
```

For rapid iteration: Vite dev server proxies `/api` to the live Anvil at port 8100. The Docker container at port 8400 only picks up changes after a rebuild.

## Common pitfalls

| Mistake | Correct approach |
|---------|-----------------|
| Adding `import X from '...'` | Use `window.X` — no ES modules |
| Editing canonical repo directly | Use `forge_develop` session |
| Hardcoding a type list | Use `activeTypes(counts)` |
| Adding a type color in only one theme block | Add to both `:root` AND `[data-theme="light"]` |
| Changing script order in `index.html` | Don't — later scripts depend on earlier globals |
