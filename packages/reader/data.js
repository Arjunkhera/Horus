// Sample Anvil data — realistic Horus developer's vault
window.HORUS_DATA = (function () {
  const notes = [];
  const edges = []; // {from, to, intent}

  function n(o) { notes.push(o); return o; }
  function e(from, to, intent) { edges.push({ from, to, intent }); }

  // ── Projects ──────────────────────────────────────────
  n({
    id: 'proj-horus-ui', type: 'project', title: 'Horus UI',
    fields: { status: 'in-progress', priority: 'P1-high' },
    tags: ['horus', 'frontend'], modified: '2026-04-29',
    body: `# Horus UI\n\nThe Horus Reader project — a minimal read-only browser for navigating Anvil content. **"Quartz for Anvil"**.\n\nReplaces the abandoned Phase-1 SPA at \`localhost:8400\`.\n\n## Goals\n- Surface the Anvil graph as navigable links\n- Content-first reading experience\n- Read-only; writes happen through Claude conversations\n\n## Active stories\n- [[Story · Auth refactor for reader]]\n- [[Story · Linked refs panel]]\n- [[Story · Wiki-link parser]]\n\n## Reference\n- [[Note · Quartz architecture notes]]\n- [[Note · Anvil edge taxonomy]]\n`,
  });
  n({
    id: 'proj-pkm-cleanup', type: 'project', title: 'PKM cleanup Q2',
    fields: { status: 'in-progress', priority: 'P2-medium' },
    tags: ['pkm', 'admin'], modified: '2026-04-22',
    body: `# PKM cleanup Q2\n\nTriage of stale tasks, retag personal areas, and consolidation of overlapping notes.\n\nMostly maintenance — see [[Journal · 2026-04-12 Cleanup decisions]].\n`
  });

  // ── Areas ─────────────────────────────────────────────
  n({ id: 'area-work', type: 'area', title: 'Work', fields: {}, tags: ['area'], modified: '2026-01-08', body: 'Work-related tasks and notes.\n' });
  n({ id: 'area-personal', type: 'area', title: 'Personal', fields: {}, tags: ['area'], modified: '2026-01-08', body: 'Personal life admin.\n' });
  n({ id: 'area-health', type: 'area', title: 'Health', fields: {}, tags: ['area'], modified: '2026-03-15', body: 'Health, fitness, sleep.\n' });

  // ── Stories ───────────────────────────────────────────
  n({
    id: 'story-auth-refactor', type: 'story', title: 'Auth refactor for reader',
    fields: { status: 'in-progress', priority: 'P2-medium', subtype: 'feature', size: 'M', project: 'Horus UI' },
    tags: ['auth', 'backend', 'horus'], modified: '2026-04-28',
    body: `# Auth refactor for reader\n\nReader currently shares the legacy SPA's auth proxy. We want it to talk directly to Anvil's MCP, so the proxy can be deleted.\n\n## Approach\n1. Switch to bearer token from \`~/.horus/auth\`\n2. Drop the Express layer\n3. Update CORS on Anvil to allow \`localhost:8400\`\n\nSee [[Note · JWT strategy]] and [[Note · Anvil edge taxonomy]].\n\n\`\`\`ts\nasync function fetchNote(id: string) {\n  const res = await fetch(\`\${ANVIL}/notes/\${id}\`, {\n    headers: { Authorization: \`Bearer \${token}\` }\n  });\n  return res.json();\n}\n\`\`\`\n\nBlocked by [[Story · Wiki-link parser]] — we need link rewriting in place first so the reader can render content meaningfully.\n`,
  });
  n({
    id: 'story-linked-refs', type: 'story', title: 'Linked refs panel',
    fields: { status: 'in-progress', priority: 'P1-high', subtype: 'feature', size: 'S', project: 'Horus UI' },
    tags: ['frontend', 'horus', 'graph'], modified: '2026-04-29',
    body: `# Linked refs panel\n\nShow incoming + outgoing graph edges, grouped by intent (\`blocks\`, \`references\`, \`mentions\`, \`parent_of\`/\`belongs_to\`).\n\n## Decisions\n- **Placement**: collapsed section at bottom of note (content-first).\n- **Grouping**: by intent, then sort by recency.\n- **Empty state**: hide section entirely when zero edges.\n\nReferences [[Note · Anvil edge taxonomy]].\n`,
  });
  n({
    id: 'story-wiki-parser', type: 'story', title: 'Wiki-link parser',
    fields: { status: 'in-review', priority: 'P1-high', subtype: 'feature', size: 'M', project: 'Horus UI' },
    tags: ['frontend', 'horus', 'parser'], modified: '2026-04-26',
    body: `# Wiki-link parser\n\nResolve \`[[Title]]\` and \`[[uuid]]\` references during markdown render. Both must produce clickable in-app links.\n\nApproach:\n1. Lex with a remark plugin\n2. Resolve title → id via Anvil index\n3. Mark unresolved as \`broken-link\`\n`,
  });
  n({
    id: 'story-recents-sidebar', type: 'story', title: 'Recents sidebar',
    fields: { status: 'done', priority: 'P2-medium', subtype: 'feature', size: 'S', project: 'Horus UI' },
    tags: ['frontend', 'horus'], modified: '2026-04-19',
    body: `# Recents sidebar\n\nPersistent left sidebar with up to 12 recently visited notes, deduped, stored in localStorage. Done.\n`,
  });
  n({
    id: 'story-search-bar', type: 'story', title: 'Search header + palette',
    fields: { status: 'open', priority: 'P2-medium', subtype: 'feature', size: 'M', project: 'Horus UI' },
    tags: ['frontend', 'horus', 'search'], modified: '2026-04-25',
    body: `# Search header + palette\n\nAlways-visible header search bar AND ⌘K palette. Both back \`horus_search\`.\n\nFilter by entity type via chips. NLP search out of scope (Phase 2).\n`,
  });

  // ── Notes (free-form) ─────────────────────────────────
  n({
    id: 'note-jwt-strategy', type: 'note', title: 'JWT strategy',
    fields: {}, tags: ['auth', 'backend', 'security'], modified: '2026-04-22',
    body: `# JWT strategy\n\nAnvil emits short-lived bearers (15min) and a refresh cookie. Reader should:\n\n- Store the bearer in memory only, never localStorage\n- Refresh on 401 transparently\n- On refresh failure, redirect to \`/auth/login\`\n\nReferenced by [[Story · Auth refactor for reader]].\n\n## Open questions\n- Rotate refresh on every use? Probably yes.\n- Bind to user-agent? Risk of breaking on browser updates.\n`,
  });
  n({
    id: 'note-edge-taxonomy', type: 'note', title: 'Anvil edge taxonomy',
    fields: {}, tags: ['horus', 'graph', 'reference'], modified: '2026-04-15',
    body: `# Anvil edge taxonomy\n\nThe five canonical edge intents:\n\n| Intent | Direction | Use |\n|---|---|---|\n| \`parent_of\` | parent → child | hierarchy |\n| \`belongs_to\` | child → parent | inverse of parent_of |\n| \`blocks\` | A → B | sequencing |\n| \`references\` | A → B | formal cite |\n| \`mentions\` | A → B | loose link |\n\nIn the reader, render \`mentions\` lighter than \`references\` to express weight.\n`,
  });
  n({
    id: 'note-quartz-arch', type: 'note', title: 'Quartz architecture notes',
    fields: {}, tags: ['research', 'horus'], modified: '2026-03-30',
    body: `# Quartz architecture notes\n\nQuartz statically generates a site from an Obsidian vault. Key ideas worth borrowing:\n\n1. **Per-page graph data** — emit JSON next to HTML.\n2. **Content-first layout** — sidebar collapses on small screens.\n3. **Backlinks at bottom** — out of the way until needed.\n\nFor Horus, the input is Anvil instead of an Obsidian vault. Most else translates.\n`,
  });
  n({
    id: 'note-keyboard-shortcuts', type: 'note', title: 'Reader keyboard shortcuts',
    fields: {}, tags: ['horus', 'frontend', 'ux'], modified: '2026-04-21',
    body: `# Reader keyboard shortcuts\n\n- **⌘K / Ctrl-K** — open search palette\n- **g h** — go home\n- **g r** — recents focus\n- **↑ ↓** — navigate results\n- **↵** — open\n- **Esc** — dismiss\n- **[ / ]** — back / forward\n`,
  });

  // ── Tasks ─────────────────────────────────────────────
  n({
    id: 'task-cors-config', type: 'task', title: 'Configure CORS for localhost:8400',
    fields: { status: 'open', priority: 'P1-high', due: '2026-04-30', area: 'Work' },
    tags: ['auth', 'backend', 'horus'], modified: '2026-04-28',
    body: 'Anvil currently restricts to `localhost:3000`. Add 8400.\n',
  });
  n({
    id: 'task-write-readme', type: 'task', title: 'Write README for reader repo',
    fields: { status: 'open', priority: 'P2-medium', area: 'Work' },
    tags: ['horus', 'docs'], modified: '2026-04-27',
    body: 'Cover: install, run, hotkeys, theming.\n',
  });
  n({
    id: 'task-renew-passport', type: 'task', title: 'Renew passport',
    fields: { status: 'open', priority: 'P2-medium', due: '2026-05-15', area: 'Personal' },
    tags: ['admin'], modified: '2026-04-09',
    body: 'Online portal. Need new photo.\n',
  });
  n({
    id: 'task-sleep-routine', type: 'task', title: 'Stick to 11pm bedtime',
    fields: { status: 'in-progress', priority: 'P3-low', area: 'Health' },
    tags: ['health', 'recurring'], modified: '2026-04-25',
    body: 'Try one week, log results in journal.\n',
  });
  n({
    id: 'task-grocery', type: 'task', title: 'Weekly groceries',
    fields: { status: 'done', priority: 'P3-low', area: 'Personal' },
    tags: ['admin'], modified: '2026-04-26',
    body: '',
  });
  n({
    id: 'task-test-anvil', type: 'task', title: 'Write integration tests for anvil_get_edges',
    fields: { status: 'open', priority: 'P2-medium', area: 'Work' },
    tags: ['horus', 'backend', 'testing'], modified: '2026-04-23',
    body: 'Cover: in/out direction filter, intent filter, missing noteId.\n',
  });

  // ── Journals (append-only) ────────────────────────────
  n({
    id: 'journal-2026-04-28', type: 'journal', title: '2026-04-28 — Wireframe review',
    fields: { date: '2026-04-28' }, tags: ['decision', 'horus'], modified: '2026-04-28',
    body: `# 2026-04-28 — Wireframe review\n\n#decision — Decided on **content-first layout** for reader. Linked refs go to the bottom, not a right rail. Council unanimous.\n\n#decision — Search will be **both** header bar and ⌘K palette. Discoverable + power-user friendly.\n\n#learning — Quartz's "page is a document" mental model maps cleanly onto Anvil notes. The graph just becomes another rendered section.\n\nSee [[Story · Linked refs panel]].\n`,
  });
  n({
    id: 'journal-2026-04-22', type: 'journal', title: '2026-04-22 — Auth dead-end',
    fields: { date: '2026-04-22' }, tags: ['gotcha', 'horus'], modified: '2026-04-22',
    body: `# 2026-04-22 — Auth dead-end\n\n#gotcha — Spent 3h trying to thread the legacy proxy. Concluded it's a sunk cost; new reader should hit Anvil directly.\n\nFiled [[Story · Auth refactor for reader]].\n`,
  });
  n({
    id: 'journal-2026-04-12', type: 'journal', title: '2026-04-12 — Cleanup decisions',
    fields: { date: '2026-04-12' }, tags: ['decision', 'pkm'], modified: '2026-04-12',
    body: `# 2026-04-12 — Cleanup decisions\n\n#decision — Merged 14 redundant tags into 6. Old tags will be retained as aliases for one quarter.\n\n#decision — Personal areas trimmed to: Work, Personal, Health.\n`,
  });
  n({
    id: 'journal-2026-04-29', type: 'journal', title: '2026-04-29 — Today',
    fields: { date: '2026-04-29' }, tags: ['log'], modified: '2026-04-29',
    body: `# 2026-04-29 — Today\n\nWorking on the [[Story · Linked refs panel]] this morning.\n\nQuick run after lunch.\n`,
  });

  // ── Bookmarks ─────────────────────────────────────────
  n({
    id: 'bookmark-quartz', type: 'bookmark', title: 'Quartz 4 — fast static site for digital gardens',
    fields: { url: 'https://quartz.jzhao.xyz' },
    tags: ['research', 'frontend'], modified: '2026-03-30',
    body: 'Reference for the reader project. Read the layouts/ source.\n',
  });
  n({
    id: 'bookmark-obsidian-graph', type: 'bookmark', title: 'Obsidian graph view internals (forum thread)',
    fields: { url: 'https://forum.obsidian.md/t/graph-internals/12345' },
    tags: ['research', 'graph'], modified: '2026-04-02',
    body: 'How Obsidian computes its graph layout. Force-directed, cached per vault.\n',
  });
  n({
    id: 'bookmark-cmdk', type: 'bookmark', title: 'cmdk — fast unstyled command palette',
    fields: { url: 'https://cmdk.paco.me' },
    tags: ['frontend', 'tools'], modified: '2026-04-18',
    body: 'For the ⌘K palette. Good keyboard model.\n',
  });

  // ── Edges ─────────────────────────────────────────────
  // Project hierarchies
  e('proj-horus-ui', 'story-auth-refactor', 'parent_of');
  e('proj-horus-ui', 'story-linked-refs', 'parent_of');
  e('proj-horus-ui', 'story-wiki-parser', 'parent_of');
  e('proj-horus-ui', 'story-recents-sidebar', 'parent_of');
  e('proj-horus-ui', 'story-search-bar', 'parent_of');

  // Story → references / blocks
  e('story-auth-refactor', 'note-jwt-strategy', 'references');
  e('story-auth-refactor', 'note-edge-taxonomy', 'references');
  e('story-wiki-parser', 'story-auth-refactor', 'blocks');
  e('story-linked-refs', 'note-edge-taxonomy', 'references');

  // Tasks belong to stories/areas
  e('task-cors-config', 'story-auth-refactor', 'belongs_to');
  e('task-test-anvil', 'story-linked-refs', 'belongs_to');
  e('task-write-readme', 'proj-horus-ui', 'belongs_to');

  e('task-renew-passport', 'area-personal', 'belongs_to');
  e('task-grocery', 'area-personal', 'belongs_to');
  e('task-sleep-routine', 'area-health', 'belongs_to');

  // Journal mentions
  e('journal-2026-04-28', 'story-linked-refs', 'mentions');
  e('journal-2026-04-22', 'story-auth-refactor', 'mentions');
  e('journal-2026-04-29', 'story-linked-refs', 'mentions');
  e('journal-2026-04-12', 'proj-pkm-cleanup', 'mentions');

  // Bookmark references
  e('bookmark-quartz', 'note-quartz-arch', 'references');
  e('note-quartz-arch', 'bookmark-quartz', 'references');

  // ── Indexes ───────────────────────────────────────────
  const byId = {};
  const byTitle = {};
  notes.forEach(n => { byId[n.id] = n; byTitle[n.title.toLowerCase()] = n.id; });

  function getEdges(id) {
    const out = edges.filter(e => e.from === id);
    const inn = edges.filter(e => e.to === id);
    return { out, in: inn };
  }
  function findByTitle(title) {
    const id = byTitle[title.toLowerCase().trim()];
    return id ? byId[id] : null;
  }
  // Strip the "Type · " prefix from wiki-link if present
  function findFuzzy(text) {
    let q = text.trim();
    // try as-is
    let n = findByTitle(q);
    if (n) return n;
    // strip "Type · " prefix
    q = q.replace(/^(story|note|journal|task|project|area|bookmark)\s*·\s*/i, '');
    n = findByTitle(q);
    if (n) return n;
    // last resort: substring match against titles
    const lq = q.toLowerCase();
    const found = notes.find(x => x.title.toLowerCase().includes(lq));
    return found || null;
  }

  function tagCounts() {
    const map = {};
    notes.forEach(n => (n.tags || []).forEach(t => { map[t] = (map[t] || 0) + 1; }));
    return map;
  }

  function typeCounts() {
    const map = {};
    notes.forEach(n => { map[n.type] = (map[n.type] || 0) + 1; });
    return map;
  }

  function search(q, typeFilter) {
    const lq = q.toLowerCase().trim();
    if (!lq) return [];
    return notes
      .filter(n => !typeFilter || n.type === typeFilter)
      .map(n => {
        const title = n.title.toLowerCase();
        const body = n.body.toLowerCase();
        const tags = (n.tags || []).join(' ').toLowerCase();
        let score = 0;
        let snippet = '';
        if (title.includes(lq)) score += 10;
        if (tags.includes(lq)) score += 4;
        if (body.includes(lq)) {
          score += 2;
          const idx = body.indexOf(lq);
          const start = Math.max(0, idx - 30);
          const end = Math.min(body.length, idx + lq.length + 50);
          snippet = (start > 0 ? '…' : '') + n.body.slice(start, end) + (end < n.body.length ? '…' : '');
        }
        return { note: n, score, snippet };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  // Pinned ids — persisted in localStorage with sensible defaults
  const PIN_KEY = 'horus:pinned';
  const PIN_DEFAULTS = ['proj-horus-ui', 'story-linked-refs', 'note-edge-taxonomy', 'journal-2026-04-29'];
  function loadPinned() {
    try {
      const v = localStorage.getItem(PIN_KEY);
      if (v === null) return [...PIN_DEFAULTS];
      return JSON.parse(v) || [];
    } catch { return [...PIN_DEFAULTS]; }
  }
  function savePinned(arr) { localStorage.setItem(PIN_KEY, JSON.stringify(arr)); }

  // ── Live data bootstrap ───────────────────────────────
  // Replaces mock data with real Anvil notes when Anvil is reachable.
  // SearchV2Hit → reader note stub (body is empty until the note is opened).
  let _onChange = null;
  let _lastSyncedAt = null;
  let _sse = null;

  function onDataChange(fn) { _onChange = fn; }
  function getLastSyncedAt() { return _lastSyncedAt; }

  async function loadFromAnvil() {
    if (!window.AnvilClient) return false;
    try {
      const live = [];
      const BATCH = 100;
      let offset = 0;
      while (true) {
        const result = await window.AnvilClient.search({ limit: BATCH, offset });
        if (!result || !result.results || result.results.length === 0) break;
        for (const hit of result.results) {
          // modified_at comes back as ISO date string from SQLite (e.g. "2026-04-29T00:00:00.000Z")
          const modified = hit.modified_at
            ? hit.modified_at.slice(0, 10)
            : '';
          live.push({
            id: hit.id,
            type: hit.type || 'note',
            title: hit.title || '(untitled)',
            tags: hit.tags || [],
            modified,
            fields: {
              ...(hit.status ? { status: hit.status } : {}),
              ...(hit.priority ? { priority: hit.priority } : {}),
            },
            body: '',   // loaded lazily by NotePage via useNote()
          });
        }
        if (live.length >= result.total || result.results.length < BATCH) break;
        offset += BATCH;
      }
      if (live.length === 0) return false; // empty vault — keep mock data

      // Replace mock data in-place so all existing references update
      notes.length = 0;
      notes.push(...live);
      edges.length = 0; // edges loaded lazily per-note via useEdges()

      // Rebuild indexes
      Object.keys(byId).forEach(k => delete byId[k]);
      Object.keys(byTitle).forEach(k => delete byTitle[k]);
      notes.forEach(n => { byId[n.id] = n; byTitle[n.title.toLowerCase()] = n.id; });

      if (_onChange) _onChange();
      return true;
    } catch (err) {
      console.warn('[horus] Anvil unreachable — using mock data', err);
      return false;
    }
  }

  // ── SSE / incremental update ──────────────────────────

  // Patch a single note into the store after receiving a note_created/note_updated event.
  // Fetches the note body-less stub from the API and updates byId/byTitle indexes.
  async function fetchAndPatchNote(noteId) {
    if (!window.AnvilClient) return;
    try {
      const raw = await window.AnvilClient.getNote(noteId);
      if (!raw || raw.error) return;
      const modified = raw.modified ? raw.modified.slice(0, 10) : '';
      const patched = {
        id: raw.noteId || noteId,
        type: raw.type || 'note',
        title: raw.title || '(untitled)',
        tags: raw.tags || [],
        modified,
        fields: {
          ...(raw.status ? { status: raw.status } : {}),
          ...(raw.priority ? { priority: raw.priority } : {}),
        },
        body: '',
      };
      const idx = notes.findIndex(n => n.id === patched.id);
      if (idx >= 0) {
        notes[idx] = patched;
      } else {
        notes.push(patched);
      }
      byId[patched.id] = patched;
      byTitle[patched.title.toLowerCase()] = patched.id;
      _lastSyncedAt = new Date().toISOString();
      if (_onChange) _onChange();
    } catch (err) {
      console.warn('[horus] fetchAndPatchNote failed', noteId, err);
    }
  }

  // Remove a note from the store after a note_deleted event.
  function removeNoteById(noteId) {
    const idx = notes.findIndex(n => n.id === noteId);
    if (idx < 0) return;
    const n = notes[idx];
    notes.splice(idx, 1);
    delete byId[noteId];
    const titleKey = n.title.toLowerCase();
    if (byTitle[titleKey] === noteId) delete byTitle[titleKey];
    _lastSyncedAt = new Date().toISOString();
    if (_onChange) _onChange();
  }

  // Delta-fetch notes modified since `since` (ISO string) — used on reconnect and manual refresh.
  async function applyDelta(since) {
    if (!window.AnvilClient) return;
    try {
      const result = await window.AnvilClient.deltaFetch(since);
      if (!result || !result.results) return;
      for (const hit of result.results) {
        await fetchAndPatchNote(hit.id);
      }
    } catch (err) {
      console.warn('[horus] delta fetch failed', err);
    }
  }

  function connectSSE() {
    if (!window.AnvilClient || !window.AnvilClient.connectSSE) return;
    if (_sse) return;
    _sse = window.AnvilClient.connectSSE({
      onEvent(event) {
        if (event.type === 'note_created' || event.type === 'note_updated') {
          fetchAndPatchNote(event.noteId);
        } else if (event.type === 'note_deleted') {
          removeNoteById(event.noteId);
        }
      },
      onReconnect() {
        if (_lastSyncedAt) applyDelta(_lastSyncedAt);
      },
    });
  }

  function disconnectSSE() {
    if (_sse) { _sse.close(); _sse = null; }
  }

  function manualRefresh() {
    if (_lastSyncedAt) {
      applyDelta(_lastSyncedAt);
    } else {
      loadFromAnvil();
    }
  }

  return {
    notes, edges, byId, byTitle, getEdges, findFuzzy, tagCounts, typeCounts, search,
    loadPinned, savePinned, loadFromAnvil, onDataChange,
    connectSSE, disconnectSSE, manualRefresh, getLastSyncedAt,
  };
})();
