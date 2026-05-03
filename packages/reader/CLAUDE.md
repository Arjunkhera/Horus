# Horus Reader — packages/reader/

Minimal read-only SPA served at `localhost:8400`. "Quartz for Anvil" — dark-theme browser for navigating Anvil notes.

## Critical: No ES Module Imports

This package has **no bundler**. React and Babel load from CDN; JSX files are transpiled in-browser. All cross-file state is via `window.*` globals. Do not add `import`/`export` statements.

## Script Load Order (index.html)

Later files depend on earlier ones — do not change this order:

```
tweaks-panel.jsx  → (no deps)
data.js           → window.HORUS_DATA
anvil-client.js   → window.ANVIL_BASE_URL
hooks.js          → window.HORUS_DATA
icons.jsx         → window.Icon
md.jsx            → window.MarkdownRenderer
pages.jsx         → uses all above
app.jsx           → root, calls ReactDOM.createRoot()
```

## Key Files

| File | What lives here |
|------|----------------|
| `app.jsx` | Root component, routing (history stack), keyboard shortcuts, tweaks |
| `pages.jsx` | **All page components**: Sidebar, HomePage, NotePage, TagPage, TypePage, SearchPalette |
| `styles.css` | All CSS + CSS custom properties (type colors, theming) |
| `data.js` | In-memory note store: `typeCounts()`, `tagCounts()`, `search()` |
| `hooks.js` | SSE real-time sync, Anvil API hooks |
| `md.jsx` | Markdown renderer with `[[wiki-link]]` support |

## Adding a New Anvil Type

Three steps, all in `pages.jsx` + `styles.css`:

1. **`pages.jsx`** — add to `TYPE_ORDER` array (controls display priority):
   ```js
   const TYPE_ORDER = ['task', 'story', ..., 'your-new-type'];
   ```

2. **`styles.css` `:root` block** — add dark-mode color (pick an unused hue):
   ```css
   --type-your-new-type: oklch(0.72 0.10 <hue>);
   ```

3. **`styles.css` `[data-theme="light"]` block** — add light-mode color:
   ```css
   --type-your-new-type: oklch(0.45 0.10 <hue>);
   ```

4. **`styles.css` dot rule** — below the other `.type-dot.*` rules:
   ```css
   .type-dot.your-new-type { background: var(--type-your-new-type); }
   ```

> Types without a dot rule still appear — they get the `--fg-3` muted fallback.

## Adding a New Page / Route

Routes are in `app.jsx`. Add a new `kind`:

1. Define a new page component in `pages.jsx`
2. Add a branch in `app.jsx`:
   ```js
   else if (route.kind === 'your-kind') pageEl = <YourPage ... />;
   ```
3. Update `crumb` computation in `app.jsx` for the breadcrumb display

## Theming

- `:root` = dark mode defaults
- `[data-theme="light"]` = light overrides
- Accent set dynamically: `document.documentElement.style.setProperty('--accent', val)`
- Type colors: `--type-{name}` variable → `.type-dot.{name}` CSS rule

## Dev Workflow

Always create a Forge session before editing:

```
forge_develop(repo: "Horus", workItem: "<id>")
→ edit files inside sessionPath/packages/reader/
→ commit + push + open PR
```

The Docker container at port 8400 rebuilds on deploy. For hot iteration, start the Vite dev server (it proxies `/api` to the live Anvil stack at port 8100).
