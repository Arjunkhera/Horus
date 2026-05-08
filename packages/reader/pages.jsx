// Page components: Sidebar, Home, Note, Tag, Type, SearchPalette
const { useState: uSp, useEffect: uEp, useMemo: uMp, useRef: uRp } = React;

// Tiny chevron icon
function Chev({ open }) {
  return <span className={`chev${open ? ' open' : ''}`}><window.Icon.Chevron /></span>;
}

// Collapsible sidebar section with chevron
function SideSection({ id, title, count, children, defaultOpen = true }) {
  const key = `horus:side-open:${id}`;
  const [open, setOpen] = uSp(() => {
    const v = localStorage.getItem(key);
    return v === null ? defaultOpen : v === '1';
  });
  function toggle() {
    setOpen(o => { localStorage.setItem(key, o ? '0' : '1'); return !o; });
  }
  return (
    <div className="side-section">
      <button className="side-section-title" onClick={toggle}>
        <Chev open={open} />
        <span className="t">{title}</span>
        {count != null && <span className="c">{count}</span>}
      </button>
      {open && <div className="side-section-body">{children}</div>}
    </div>
  );
}

// ── Sync footer ──────────────────────────────────────────────────
function SyncFooter({ lastSyncedAt, onRefresh }) {
  if (!lastSyncedAt) return null;
  const diffMs = Date.now() - new Date(lastSyncedAt).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const label = diffMin < 1 ? 'just now' : diffMin === 1 ? '1m ago' : `${diffMin}m ago`;
  return (
    <div className="side-footer">
      <span className="side-sync-label">Synced {label}</span>
      <button className="side-sync-btn icon-btn" title="Refresh" onClick={onRefresh}>↻</button>
    </div>
  );
}

// Generic overflow/context menu — items: [{ label, onClick, danger?, separator? }]
function OverflowMenu({ items, onClose }) {
  const ref = uRp();
  uEp(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return (
    <div className="overflow-menu" ref={ref}>
      {items.map((item, i) =>
        item.separator
          ? <div key={i} className="overflow-menu-sep" />
          : <button key={i} className={`overflow-menu-item${item.danger ? ' danger' : ''}`} onClick={() => { onClose(); item.onClick(); }}>{item.label}</button>
      )}
    </div>
  );
}

// ── Type ordering ────────────────────────────────────────────────
const TYPE_ORDER = ['task', 'story', 'note', 'journal', 'project', 'area', 'bookmark', 'conversation-state', 'person', 'service', 'meeting'];
// Returns all types that have ≥1 note: known types first (TYPE_ORDER), then extras by count
function activeTypes(counts) {
  const known = TYPE_ORDER.filter(t => counts[t] > 0);
  const extra = Object.keys(counts).filter(t => counts[t] > 0 && !TYPE_ORDER.includes(t))
    .sort((a, b) => counts[b] - counts[a]);
  return [...known, ...extra];
}

// ── Sidebar ──────────────────────────────────────────────────────
const SIDE_LIMIT = 8; // static cap for Phase 1
function Sidebar({ recents, currentRoute, onNavigate, typeCounts, collapsed, pinned, togglePin, lastSyncedAt, onRefresh }) {
  const data = window.HORUS_DATA;
  const [ctxMenu, setCtxMenu] = uSp(null); // { id, x, y }
  const [deleteTarget, setDeleteTarget] = uSp(null);
  const [deleteLoading, setDeleteLoading] = uSp(false);
  const [deleteError, setDeleteError] = uSp(null);

  uEp(() => {
    if (!ctxMenu) return;
    function handler() { setCtxMenu(null); }
    function onKey(e) { if (e.key === 'Escape') setCtxMenu(null); }
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', onKey); };
  }, [!!ctxMenu]);

  async function handleSidebarDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await window.AnvilClient.deleteNote(deleteTarget.id);
      window.HORUS_DATA.removeNoteById(deleteTarget.id);
      if (window.HOOKS) {
        window.HOOKS.invalidate('note:' + deleteTarget.id);
        window.HOOKS.invalidate('edges:' + deleteTarget.id);
      }
      const wasViewing = currentRoute.kind === 'note' && currentRoute.id === deleteTarget.id;
      setDeleteTarget(null);
      setDeleteLoading(false);
      if (wasViewing) onNavigate({ kind: 'home' });
    } catch (err) {
      setDeleteLoading(false);
      if (err.status === 404) {
        setDeleteError('This note has already been deleted.');
        setTimeout(() => { setDeleteTarget(null); setDeleteError(null); }, 2000);
      } else {
        setDeleteError('Delete failed. Please try again.');
      }
    }
  }

  if (collapsed) {
    return (
      <aside className="side collapsed">
        <div className="side-rail">
          <button className="side-rail-btn" title="Recents" onClick={() => onNavigate({ kind: 'home' })}>⟲</button>
          {activeTypes(typeCounts).map(t => (
            <button key={t} className="side-rail-btn" title={t} onClick={() => onNavigate({ kind: 'type', type: t })}>
              <span className={`type-dot ${t}`}></span>
            </button>
          ))}
        </div>
      </aside>
    );
  }

  function noteRow(id, opts = {}) {
    const n = data.byId[id];
    if (!n) return null;
    const active = currentRoute.kind === 'note' && currentRoute.id === id;
    const isConvState = n.type === 'conversation-state';

    function openCtxMenu(e) {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      setCtxMenu({ id, x: rect.left, y: rect.bottom + 4 });
    }

    return (
      <div key={id} className={`side-link-wrap${active ? ' active' : ''}`}>
        <button className="side-link" onClick={() => onNavigate({ kind: 'note', id })}>
          <span className={`type-dot ${n.type}`} />
          <span className="label">{n.title}</span>
        </button>
        <button className="side-ctx-btn" title="More actions" onClick={openCtxMenu}>⋯</button>
        {ctxMenu && ctxMenu.id === id && (
          <div
            className="side-ctx-menu"
            style={{ top: ctxMenu.y, left: Math.min(ctxMenu.x, window.innerWidth - 160) }}
            onMouseDown={e => e.stopPropagation()}
          >
            <button className="side-ctx-menu-item" onClick={() => { setCtxMenu(null); togglePin(id); }}>
              {opts.isPinned ? 'Unpin' : 'Pin'}
            </button>
            {!isConvState && (
              <>
                <div className="side-ctx-menu-sep" />
                <button className="side-ctx-menu-item danger" onClick={() => { setCtxMenu(null); setDeleteTarget(n); }}>
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  const recentsCapped = recents.slice(0, SIDE_LIMIT);
  const pinnedCapped = (pinned || []).slice(0, SIDE_LIMIT);
  const pinnedResolved = pinnedCapped.filter(id => !!data.byId[id]);

  return (
    <aside className="side">
      <SideSection id="pinned" title="Pinned" count={pinnedResolved.length || null}>
        {pinnedResolved.length === 0
          ? <div className="side-empty">No pins yet — open a note and click the pin icon</div>
          : pinnedResolved.map(id => noteRow(id, { isPinned: true }))}
      </SideSection>

      <SideSection id="recents" title="Recents" count={recentsCapped.length || null}>
        {recentsCapped.length === 0 ? <div className="side-empty">No notes yet</div> : recentsCapped.map(id => noteRow(id))}
      </SideSection>

      <SideSection id="types" title="Browse by type">
        {activeTypes(typeCounts).map(t => {
          const c = typeCounts[t] || 0;
          const active = currentRoute.kind === 'type' && currentRoute.type === t;
          return (
            <button key={t} className={`side-link${active ? ' active' : ''}`} onClick={() => onNavigate({ kind: 'type', type: t })}>
              <span className={`type-dot ${t}`} />
              <span className="label">{t}</span>
              <span className="meta">{c}</span>
            </button>
          );
        })}
      </SideSection>

      <SideSection id="tags" title="Top tags" defaultOpen={false}>
        {Object.entries(data.tagCounts())
          .sort((a, b) => b[1] - a[1]).slice(0, SIDE_LIMIT).map(([t, c]) => {
            const active = currentRoute.kind === 'tag' && currentRoute.tag === t;
            return (
              <button key={t} className={`side-link${active ? ' active' : ''}`} onClick={() => onNavigate({ kind: 'tag', tag: t })}>
                <span style={{ color: 'var(--fg-3)', width: 10, fontFamily: 'var(--font-mono)' }}>#</span>
                <span className="label">{t}</span>
                <span className="meta">{c}</span>
              </button>
            );
          })}
      </SideSection>

      <SyncFooter lastSyncedAt={lastSyncedAt} onRefresh={onRefresh} />
      {deleteTarget && (
        <window.ConfirmDeleteModal
          note={deleteTarget}
          edgeCount={null}
          onConfirm={handleSidebarDelete}
          onCancel={() => { if (!deleteLoading) { setDeleteTarget(null); setDeleteError(null); } }}
          isLoading={deleteLoading}
          errorMsg={deleteError}
        />
      )}
    </aside>
  );
}

// ── Home ─────────────────────────────────────────────────────────
function HomePage({ onNavigate }) {
  const data = window.HORUS_DATA;
  const counts = data.typeCounts();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const greet = today.toLocaleDateString('en-US', { weekday: 'long' });

  const [browseOpen, setBrowseOpen] = uSp(() => localStorage.getItem('horus:home-browse') !== '0');
  const [collapsedDays, setCollapsedDays] = uSp({});
  const [jumpOpen, setJumpOpen] = uSp(false);
  const [jumpDate, setJumpDate] = uSp('');

  // Last 7 days
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - 6);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const recent = data.notes
    .filter(n => (n.modified || '') >= cutoffStr)
    .sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));

  const groups = {};
  recent.forEach(n => { (groups[n.modified] = groups[n.modified] || []).push(n); });
  const dayKeys = Object.keys(groups).sort().reverse();

  // Older note for "jump to date"
  const allDates = [...new Set(data.notes.map(n => n.modified).filter(Boolean))].sort().reverse();

  const orderedTypes = activeTypes(counts);

  function toggleBrowse() {
    setBrowseOpen(o => { localStorage.setItem('horus:home-browse', o ? '0' : '1'); return !o; });
  }
  function toggleDay(d) { setCollapsedDays(p => ({ ...p, [d]: !p[d] })); }

  const todayStr = today.toISOString().slice(0, 10);
  const yesterdayStr = new Date(today - 86400000).toISOString().slice(0, 10);
  function dateLabel(d) {
    if (d === todayStr) return 'Today';
    if (d === yesterdayStr) return 'Yesterday';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-US', { weekday: 'long' });
  }
  function dateSub(d) {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function jumpTo() {
    if (!jumpDate) return;
    // find nearest note with modified <= jumpDate
    const target = data.notes
      .filter(n => n.modified && n.modified <= jumpDate)
      .sort((a, b) => (b.modified || '').localeCompare(a.modified || ''))[0];
    if (target) onNavigate({ kind: 'note', id: target.id });
    setJumpOpen(false);
  }

  return (
    <div className="main-inner">
      <div className="greeting">
        <h2>{greet}, welcome back.</h2>
        <div className="sub">{today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · {data.notes.length} notes</div>
      </div>

      {/* NLP Ask Bar */}
      <div className="ask-bar-wrap">
        <div className="ask-bar">
          <span className="ask-bar-icon">✦</span>
          <input
            className="ask-bar-input"
            placeholder="Ask anything about your notes…"
            onKeyDown={e => {
              if (e.key === 'Enter' && e.target.value.trim()) {
                const q = e.target.value.trim();
                const sid = window.ChatSessionStore.createSession(q);
                window.__pendingAskQuery = { sessionId: sid, question: q };
                onNavigate({ kind: 'ask' });
              }
            }}
          />
          <button className="ask-bar-btn" onClick={e => {
            const input = e.target.closest('.ask-bar').querySelector('.ask-bar-input');
            const q = input.value.trim();
            if (!q) return;
            const sid = window.ChatSessionStore.createSession(q);
            window.__pendingAskQuery = { sessionId: sid, question: q };
            onNavigate({ kind: 'ask' });
          }}>Ask ↵</button>
        </div>
        <div className="ask-chips">
          {['What did I decide about auth?', 'Open tasks this week', 'Summarise Horus UI project', 'What did I write last Tuesday?', 'Any blockers on Phase 3?'].map(q => (
            <button key={q} className="ask-chip" onClick={() => {
              const sid = window.ChatSessionStore.createSession(q);
              window.__pendingAskQuery = { sessionId: sid, question: q };
              onNavigate({ kind: 'ask' });
            }}>{q}</button>
          ))}
        </div>
      </div>

      {/* Collapsible Browse by type */}
      <div className="home-section">
        <button className="home-section-head" onClick={toggleBrowse}>
          <Chev open={browseOpen} />
          <span className="t">Browse by type</span>
          <span className="c">{Object.values(counts).reduce((a, b) => a + b, 0)}</span>
        </button>
        {browseOpen && (
          <div className="type-strip">
            {orderedTypes.map(t => (
              <button key={t} className="type-tile" onClick={() => onNavigate({ kind: 'type', type: t })}>
                <div className="row">
                  <span className={`type-dot ${t}`} />
                  <span className="label">{t}</span>
                </div>
                <span className="count">{counts[t] || 0}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Activity feed */}
      <div className="home-section">
        <div className="home-section-head static">
          <span className="t">Recent activity</span>
          <span className="c">past 7 days</span>
          <span className="grow" />
          <button className="link-btn" onClick={() => setJumpOpen(o => !o)}>Jump to date…</button>
        </div>
        {jumpOpen && (
          <div className="jump-row">
            <input
              type="date"
              className="date-input"
              value={jumpDate}
              min={allDates[allDates.length - 1] || '2026-01-01'}
              max={todayStr}
              onChange={e => setJumpDate(e.target.value)}
            />
            <button className="chip active" onClick={jumpTo}>Go</button>
            <button className="chip" onClick={() => setJumpOpen(false)}>Cancel</button>
          </div>
        )}

        <div className="activity">
          {dayKeys.length === 0 ? <div className="empty">No activity in the past 7 days.</div> : dayKeys.map(d => {
            const isCollapsed = !!collapsedDays[d];
            return (
              <div key={d} className="day-group">
                <button className="day-head" onClick={() => toggleDay(d)}>
                  <Chev open={!isCollapsed} />
                  <span className="day-label">{dateLabel(d)}</span>
                  <span className="day-sub">{dateSub(d)}</span>
                  <span className="day-count">{groups[d].length} item{groups[d].length !== 1 ? 's' : ''}</span>
                </button>
                {!isCollapsed && groups[d].map(n => (
                  <div key={n.id} className="act-item" onClick={() => onNavigate({ kind: 'note', id: n.id })}>
                    <window.MD.TypePill type={n.type} />
                    <span className="title">{n.title}</span>
                    <span className="meta">{n.fields?.status || (n.tags || []).slice(0, 2).join(' · ')}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Note view (option C: contextual right rail per type) ────────
function NotePage({ noteId, onNavigate, refsCollapsed, setRefsCollapsed, pinned, togglePin }) {
  const data = window.HORUS_DATA;
  const HOOKS = window.HOOKS;
  const [menuOpen, setMenuOpen] = uSp(false);
  const [deleteOpen, setDeleteOpen] = uSp(false);
  const [deleteLoading, setDeleteLoading] = uSp(false);
  const [deleteError, setDeleteError] = uSp(null);

  async function handleDeleteConfirm() {
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await window.AnvilClient.deleteNote(noteId);
      data.removeNoteById(noteId);
      if (HOOKS) {
        HOOKS.invalidate('note:' + noteId);
        HOOKS.invalidate('edges:' + noteId);
      }
      onNavigate({ kind: 'home' });
    } catch (err) {
      setDeleteLoading(false);
      if (err.status === 404) {
        setDeleteError('This note has already been deleted.');
        setTimeout(() => { setDeleteOpen(false); setDeleteError(null); }, 2000);
      } else {
        setDeleteError('Delete failed. Please try again.');
      }
    }
  }

  // Fetch full note content from Anvil (falls back to mock data when offline)
  const { data: liveNote, loading: noteLoading } = HOOKS
    ? HOOKS.useNote(noteId)
    : { data: null, loading: false };

  // Merge: live note body overwrites stub; fall back to mock data entirely
  const stub = data.byId[noteId];
  const note = liveNote
    ? {
        ...stub,
        ...liveNote,
        // Normalise noteId → id
        id: liveNote.noteId || liveNote.id || noteId,
        fields: liveNote.fields || stub?.fields || {},
        tags: liveNote.tags || stub?.tags || [],
        modified: liveNote.modified?.slice(0, 10) || stub?.modified || '',
      }
    : stub;

  // Cache live note in data store for wiki-link resolution (effect, not render)
  uEp(() => {
    if (liveNote && note) {
      data.byId[note.id] = note;
      if (note.title) data.byTitle[note.title.toLowerCase()] = note.id;
    }
  }, [liveNote]);

  // Fetch edges from Neo4j via Anvil (falls back to mock edge store)
  const { data: edgesData } = HOOKS
    ? HOOKS.useEdges(noteId)
    : { data: null };

  // Normalise edges: prefer Neo4j result; fall back to SQLite relationships
  let out = [], inn = [];
  if (edgesData) {
    out = edgesData.edges.filter(e => e.direction === 'outgoing').map(e => ({ from: e.sourceId, to: e.targetId, intent: e.intent }));
    inn = edgesData.edges.filter(e => e.direction === 'incoming').map(e => ({ from: e.sourceId, to: e.targetId, intent: e.intent }));
  } else {
    const fallback = data.getEdges(noteId);
    out = fallback.out;
    inn = fallback.in;
  }

  if (!note && noteLoading) {
    return <div className="main-inner"><div className="empty loading">Loading…</div></div>;
  }
  if (!note) return <div className="main-inner"><div className="empty">Note not found</div></div>;

  const isPinned = (pinned || []).includes(noteId);
  const totalEdges = out.length + inn.length;

  const groupBy = (arr) => {
    const map = {};
    arr.forEach(e => { (map[e.intent] = map[e.intent] || []).push(e); });
    return map;
  };
  const outG = groupBy(out);
  const inG = groupBy(inn);

  // Contextual content per type (shown above linked refs in the rail)
  function ContextualBlock() {
    if (note.type === 'task') {
      const sub = data.notes.filter(n => n.type === 'task' && n.fields?.area === (note.fields?.area || note.fields?.area) && n.id !== note.id).slice(0, 4);
      return (
        <div className="rail-block">
          <div className="rail-block-title">Task details</div>
          <div className="kv"><span className="k">status</span><span className="v">{note.fields?.status || 'open'}</span></div>
          {note.fields?.priority && <div className="kv"><span className="k">priority</span><span className="v">{note.fields.priority}</span></div>}
          {note.fields?.due && <div className="kv"><span className="k">due</span><span className="v">{window.MD.fmtDate(note.fields.due)}</span></div>}
          {note.fields?.area && <div className="kv"><span className="k">area</span><span className="v">{note.fields.area}</span></div>}
          {sub.length > 0 && (
            <>
              <div className="rail-sub">Other tasks in this area</div>
              {sub.map(t => (
                <div key={t.id} className="rail-row" onClick={() => onNavigate({ kind: 'note', id: t.id })}>
                  <span className={`type-dot task`} /><span className="title">{t.title}</span>
                </div>
              ))}
            </>
          )}
        </div>
      );
    }
    if (note.type === 'journal') {
      const dt = note.fields?.date && new Date(note.fields.date);
      // adjacent journals
      const journals = data.notes.filter(n => n.type === 'journal').sort((a, b) => (a.fields?.date || '').localeCompare(b.fields?.date || ''));
      const idx = journals.findIndex(j => j.id === note.id);
      const prev = journals[idx - 1], next = journals[idx + 1];
      return (
        <div className="rail-block">
          <div className="rail-block-title">Journal</div>
          {dt && <div className="kv"><span className="k">date</span><span className="v">{dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</span></div>}
          <div className="rail-sub">Adjacent entries</div>
          {prev && <div className="rail-row" onClick={() => onNavigate({ kind: 'note', id: prev.id })}><span style={{ color: 'var(--fg-3)' }}>←</span> <span className="title">{prev.title}</span></div>}
          {next && <div className="rail-row" onClick={() => onNavigate({ kind: 'note', id: next.id })}><span style={{ color: 'var(--fg-3)' }}>→</span> <span className="title">{next.title}</span></div>}
          {!prev && !next && <div className="side-empty">No adjacent entries</div>}
        </div>
      );
    }
    if (note.type === 'project' || note.type === 'story') {
      // children (parent_of)
      const children = out.filter(e => e.intent === 'parent_of').map(e => data.byId[e.to]).filter(Boolean);
      const blockedBy = inn.filter(e => e.intent === 'blocks').map(e => data.byId[e.from]).filter(Boolean);
      return (
        <div className="rail-block">
          <div className="rail-block-title">{note.type === 'project' ? 'Project' : 'Story'}</div>
          <div className="kv"><span className="k">status</span><span className="v">{note.fields?.status || '—'}</span></div>
          {note.fields?.priority && <div className="kv"><span className="k">priority</span><span className="v">{note.fields.priority}</span></div>}
          {note.fields?.size && <div className="kv"><span className="k">size</span><span className="v">{note.fields.size}</span></div>}
          {children.length > 0 && (
            <>
              <div className="rail-sub">Children · {children.length}</div>
              {children.map(c => (
                <div key={c.id} className="rail-row" onClick={() => onNavigate({ kind: 'note', id: c.id })}>
                  <span className={`type-dot ${c.type}`} /><span className="title">{c.title}</span>
                </div>
              ))}
            </>
          )}
          {blockedBy.length > 0 && (
            <>
              <div className="rail-sub">Blocked by</div>
              {blockedBy.map(b => (
                <div key={b.id} className="rail-row" onClick={() => onNavigate({ kind: 'note', id: b.id })}>
                  <span className={`type-dot ${b.type}`} /><span className="title">{b.title}</span>
                </div>
              ))}
            </>
          )}
        </div>
      );
    }
    if (note.type === 'bookmark') {
      return (
        <div className="rail-block">
          <div className="rail-block-title">Bookmark</div>
          {note.fields?.url && (
            <a className="rail-extlink" href={note.fields.url} target="_blank" rel="noreferrer">
              <span className="ico">↗</span><span className="url">{note.fields.url.replace(/^https?:\/\//, '')}</span>
            </a>
          )}
        </div>
      );
    }
    // note / area
    return (
      <div className="rail-block">
        <div className="rail-block-title">{note.type === 'area' ? 'Area' : 'Note'}</div>
        <div className="kv"><span className="k">type</span><span className="v">{note.type}</span></div>
        <div className="kv"><span className="k">last-mod</span><span className="v">{note.modified}</span></div>
      </div>
    );
  }

  return (
    <div className={`note-layout${refsCollapsed ? ' rail-collapsed' : ''}`}>
      <div className="main-inner note-main">
        <header className={`note-header type-${note.type}`}>
          <div className="note-meta-row">
            <window.MD.TypePill type={note.type} />
            {note.fields?.status && <window.MD.StatusChip status={note.fields.status} />}
            {note.fields?.priority && <window.MD.PriorityChip priority={note.fields.priority} />}
            {note.fields?.size && <span className="chip">size {note.fields.size}</span>}
            {note.fields?.subtype && <span className="chip">{note.fields.subtype}</span>}
          </div>
          <h1 className="note-title">{note.title}</h1>
          <div className="note-title-actions">
            <button className={`pin-btn${isPinned ? ' active' : ''}`} title={isPinned ? 'Unpin from sidebar' : 'Pin to sidebar'} onClick={() => togglePin(noteId)}>
              <window.Icon.Pin filled={isPinned} />
              <span>{isPinned ? 'Pinned' : 'Pin'}</span>
            </button>
            {note.type !== 'conversation-state' && (
              <div className="overflow-menu-wrap">
                <button className="overflow-btn" title="More actions" onClick={() => setMenuOpen(o => !o)}>⋯</button>
                {menuOpen && (
                  <OverflowMenu
                    items={[{ label: 'Delete', danger: true, onClick: () => setDeleteOpen(true) }]}
                    onClose={() => setMenuOpen(false)}
                  />
                )}
              </div>
            )}
          </div>
          {(note.tags || []).length > 0 && (
            <div className="note-tags">
              {note.tags.map(t => (
                <button key={t} className="chip tag" onClick={() => onNavigate({ kind: 'tag', tag: t })}>{t}</button>
              ))}
            </div>
          )}
        </header>

        {note.type === 'task' && (
          <div className="task-status-block">
            <span className={`checkbox${note.fields?.status === 'done' ? ' checked' : ''}`}></span>
            <span className="label">{note.fields?.status === 'done' ? 'Completed' : `Status: ${note.fields?.status || 'open'}`}</span>
            {note.fields?.due && <span className="due">due {window.MD.fmtDate(note.fields.due)}</span>}
          </div>
        )}

        {note.type === 'journal' && note.fields?.date && (
          <div className="journal-date-block">
            <div className="big">{new Date(note.fields.date).getDate()}</div>
            <div>
              <div className="word">{new Date(note.fields.date).toLocaleDateString('en-US', { month: 'short' })}</div>
              <div className="word">{new Date(note.fields.date).toLocaleDateString('en-US', { weekday: 'long' })}</div>
            </div>
          </div>
        )}

        {note.type === 'bookmark' && note.fields?.url && (
          <div className="bookmark-link-block">
            <span className="ico">↗</span>
            <span className="url">{note.fields.url}</span>
            <span className="open-ext">opens externally</span>
          </div>
        )}

        <article className="md">
          <window.MD.MarkdownBody body={note.body} onNavigate={(id) => onNavigate({ kind: 'note', id })} />
        </article>
      </div>

      {/* Collapsible right rail */}
      <aside className={`note-rail${refsCollapsed ? ' collapsed' : ''}`}>
        {!refsCollapsed && (
          <div className="rail-inner">
            <ContextualBlock />

            {totalEdges > 0 && (
              <div className="rail-block">
                <div className="rail-block-title">Linked references <span className="rail-count">{totalEdges}</span></div>
                {Object.keys(outG).length > 0 && (
                  <div className="rail-edges">
                    <div className="edge-dir">→ Outgoing</div>
                    {Object.entries(outG).map(([intent, items]) => (
                      <div key={intent}>
                        <div className="edge-intent">{window.MD.edgeLabel(intent, 'out')}</div>
                        {items.map(e => {
                          const t = data.byId[e.to];
                          const title = t?.title || e.targetTitle || e.to;
                          const type = t?.type || e.targetType || 'note';
                          return (
                            <div key={e.to + intent} className="rail-row" onClick={() => onNavigate({ kind: 'note', id: e.to })}>
                              <span className={`type-dot ${type}`} /><span className="title">{title}</span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
                {Object.keys(inG).length > 0 && (
                  <div className="rail-edges">
                    <div className="edge-dir">← Incoming</div>
                    {Object.entries(inG).map(([intent, items]) => (
                      <div key={intent}>
                        <div className="edge-intent">{window.MD.edgeLabel(intent, 'in')}</div>
                        {items.map(e => {
                          const f = data.byId[e.from];
                          const title = f?.title || e.sourceTitle || e.from;
                          const type = f?.type || e.sourceType || 'note';
                          return (
                            <div key={e.from + intent} className="rail-row" onClick={() => onNavigate({ kind: 'note', id: e.from })}>
                              <span className={`type-dot ${type}`} /><span className="title">{title}</span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </aside>
      {deleteOpen && note && (
        <window.ConfirmDeleteModal
          note={note}
          edgeCount={totalEdges}
          onConfirm={handleDeleteConfirm}
          onCancel={() => { if (!deleteLoading) { setDeleteOpen(false); setDeleteError(null); } }}
          isLoading={deleteLoading}
          errorMsg={deleteError}
        />
      )}
    </div>
  );
}

// ── Tag list (hybrid: cards + list) ─────────────────────────────
function TagPage({ tag, onNavigate }) {
  const data = window.HORUS_DATA;
  const matches = data.notes.filter(n => (n.tags || []).includes(tag))
    .sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
  const work = matches.filter(n => n.type === 'task' || n.type === 'story' || n.type === 'project');
  const ref = matches.filter(n => !['task', 'story', 'project'].includes(n.type));

  const related = {};
  matches.forEach(n => (n.tags || []).forEach(t => { if (t !== tag) related[t] = (related[t] || 0) + 1; }));
  const relatedSorted = Object.entries(related).sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <div className="main-inner wide">
      <div className="list-head">
        <h2><span style={{ color: 'var(--fg-3)' }}>#</span>{tag}</h2>
        <div className="sub">{matches.length} note{matches.length !== 1 ? 's' : ''} · last updated {window.MD.fmtRelative(matches[0]?.modified)}</div>
      </div>

      {relatedSorted.length > 0 && (
        <div className="filter-row">
          <span className="filter-label">RELATED:</span>
          {relatedSorted.map(([t, c]) => (
            <button key={t} className="chip tag" onClick={() => onNavigate({ kind: 'tag', tag: t })}>{t} <span style={{ color: 'var(--fg-3)' }}>·{c}</span></button>
          ))}
        </div>
      )}

      {work.length > 0 && (
        <div className="list-section">
          <div className="list-section-title">Active work <span className="count">· {work.length}</span></div>
          <div className="card-grid">
            {work.map(n => (
              <div key={n.id} className={`work-card ${n.type}`} onClick={() => onNavigate({ kind: 'note', id: n.id })}>
                <div className="row between">
                  <window.MD.TypePill type={n.type} />
                  <div className="row chips">
                    {n.fields?.status && <window.MD.StatusChip status={n.fields.status} />}
                    {n.fields?.priority && <window.MD.PriorityChip priority={n.fields.priority} />}
                  </div>
                </div>
                <div className="title">{n.title}</div>
                <div className="body">{n.body.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 1).join('').slice(0, 110)}…</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {ref.length > 0 && (
        <div className="list-section">
          <div className="list-section-title">Reference <span className="count">· {ref.length}</span></div>
          <div className="ref-list">
            {ref.map(n => (
              <div key={n.id} className="ref-row" onClick={() => onNavigate({ kind: 'note', id: n.id })}>
                <window.MD.TypePill type={n.type} />
                <div>
                  <div className="title">{n.title}</div>
                  <div className="snippet">{n.body.replace(/^#.*$/gm, '').replace(/\n+/g, ' ').trim().slice(0, 90)}…</div>
                </div>
                <span className="meta">{window.MD.fmtRelative(n.modified)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Type list (sortable) ────────────────────────────────────────
const PRIORITY_ORDER = { 'P1-high': 0, 'P2-medium': 1, 'P3-low': 2 };
const STATUS_ORDER = { 'open': 0, 'in-progress': 1, 'in-review': 2, 'done': 3 };

function TypePage({ type, onNavigate }) {
  const data = window.HORUS_DATA;
  const all = data.notes.filter(n => n.type === type);
  const [sortBy, setSortBy] = uSp('modified');
  const [sortDir, setSortDir] = uSp('desc');

  const sorted = uMp(() => {
    const arr = [...all];
    arr.sort((a, b) => {
      let av, bv;
      if (sortBy === 'title') { av = a.title.toLowerCase(); bv = b.title.toLowerCase(); }
      else if (sortBy === 'status') { av = STATUS_ORDER[a.fields?.status] ?? 99; bv = STATUS_ORDER[b.fields?.status] ?? 99; }
      else if (sortBy === 'priority') { av = PRIORITY_ORDER[a.fields?.priority] ?? 99; bv = PRIORITY_ORDER[b.fields?.priority] ?? 99; }
      else if (sortBy === 'due') { av = a.fields?.due || '9999-12-31'; bv = b.fields?.due || '9999-12-31'; }
      else { av = a.modified || ''; bv = b.modified || ''; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [all, sortBy, sortDir]);

  const isTask = type === 'task';
  const sortOptions = isTask
    ? [
        { v: 'modified', l: 'Modified' },
        { v: 'status', l: 'Status' },
        { v: 'priority', l: 'Priority' },
        { v: 'due', l: 'Due date' },
        { v: 'title', l: 'Title' },
      ]
    : [
        { v: 'modified', l: 'Modified' },
        { v: 'title', l: 'Title' },
        ...(type === 'story' || type === 'project' ? [{ v: 'status', l: 'Status' }, { v: 'priority', l: 'Priority' }] : []),
      ];

  function flipDir() { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }

  return (
    <div className="main-inner wide">
      <div className="list-head">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className={`type-dot ${type}`} style={{ width: 12, height: 12 }}></span>
          {type}<span style={{ color: 'var(--fg-3)', fontSize: 18, fontFamily: 'var(--font-mono)' }}>· {all.length}</span>
        </h2>
      </div>

      <div className="sort-bar">
        <span className="filter-label">SORT:</span>
        {sortOptions.map(o => (
          <button key={o.v}
            className={`chip${sortBy === o.v ? ' active' : ''}`}
            onClick={() => setSortBy(o.v)}>{o.l}</button>
        ))}
        <button className="chip dir" onClick={flipDir} title={`Direction: ${sortDir}`}>
          {sortDir === 'asc' ? '↑ asc' : '↓ desc'}
        </button>
      </div>

      <div className="ref-list">
        {sorted.map(n => (
          <div key={n.id} className="ref-row type-row" onClick={() => onNavigate({ kind: 'note', id: n.id })}>
            <div className="chips">
              {n.fields?.status && <window.MD.StatusChip status={n.fields.status} />}
              {n.fields?.priority && <window.MD.PriorityChip priority={n.fields.priority} />}
              {isTask && n.fields?.due && (
                <span className="chip" style={{ fontFamily: 'var(--font-mono)' }}>due {window.MD.fmtDate(n.fields.due)}</span>
              )}
            </div>
            <div>
              <div className="title">{n.title}</div>
              <div className="snippet">{(n.tags || []).map(t => `#${t}`).join(' ')}</div>
            </div>
            <span className="meta">{window.MD.fmtRelative(n.modified)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Search palette ──────────────────────────────────────────────
function SearchPalette({ onClose, onNavigate }) {
  const [q, setQ] = uSp('');
  const [debouncedQ, setDebouncedQ] = uSp('');
  const [filter, setFilter] = uSp(null);
  const [active, setActive] = uSp(0);
  const inputRef = uRp();
  const data = window.HORUS_DATA;
  const HOOKS = window.HOOKS;

  // Debounce search query by 150ms
  uEp(() => {
    const t = setTimeout(() => setDebouncedQ(q), 150);
    return () => clearTimeout(t);
  }, [q]);

  // Live search via Anvil using debounced query
  const liveSearch = HOOKS ? HOOKS.useSearch(debouncedQ.trim(), filter, 12) : { data: null, loading: false };

  uEp(() => {
    inputRef.current?.focus();
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const results = uMp(() => {
    if (!q.trim()) {
      const r = JSON.parse(localStorage.getItem('horus:recents') || '[]')
        .map(id => data.byId[id]).filter(Boolean)
        .filter(n => !filter || n.type === filter)
        .slice(0, 6);
      return r.map(n => ({ note: n, score: 0, snippet: '' }));
    }
    // Prefer live Anvil results (uses debounced query); fall back to local search
    if (debouncedQ.trim() && liveSearch.data?.results?.length > 0) {
      return liveSearch.data.results.map(hit => ({
        note: data.byId[hit.id] || { id: hit.id, type: hit.type, title: hit.title, tags: hit.tags || [], fields: { status: hit.status }, modified: hit.modified_at?.slice(0, 10) || '', body: '' },
        score: hit.score,
        snippet: hit.snippet || '',
      }));
    }
    return data.search(q, filter).slice(0, 12);
  }, [q, debouncedQ, filter, liveSearch.data]);

  uEp(() => { setActive(0); }, [q, filter]);

  function open(idx) { const r = results[idx]; if (!r) return; onNavigate({ kind: 'note', id: r.note.id }); onClose(); }
  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); open(active); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const types = [null, ...activeTypes(data.typeCounts())];
      const idx = types.indexOf(filter);
      setFilter(types[(idx + 1) % types.length]);
    }
  }
  function highlight(text, query) {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return <>{text.slice(0, idx)}<mark>{text.slice(idx, idx + query.length)}</mark>{text.slice(idx + query.length)}</>;
  }

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={e => e.stopPropagation()}>
        <div className="palette-input-row">
          <span className="ico">⌕</span>
          <input ref={inputRef} className="palette-input" placeholder="Search Horus…"
            value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKeyDown} />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-filters">
          <span className="filter-label">FILTER:</span>
          <button className={`chip${filter === null ? ' active' : ''}`} onClick={() => setFilter(null)}>all</button>
          {activeTypes(data.typeCounts()).map(t => (
            <button key={t} className={`chip${filter === t ? ' active' : ''}`} onClick={() => setFilter(t)}>
              <span className={`type-dot ${t}`} style={{ width: 6, height: 6, display: 'inline-block', borderRadius: '50%' }}></span>
              {t}
            </button>
          ))}
        </div>
        <div className="palette-results">
          {results.length === 0 ? (
            <div className="palette-empty">{q ? 'No matches' : 'Start typing to search…'}</div>
          ) : (
            results.map((r, idx) => (
              <div key={r.note.id} className={`palette-result${idx === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(idx)} onClick={() => open(idx)}>
                <window.MD.TypePill type={r.note.type} />
                <div>
                  <div className="title">{q ? highlight(r.note.title, q) : r.note.title}</div>
                  {r.snippet && <div className="snippet" dangerouslySetInnerHTML={{ __html: r.snippet }} />}
                </div>
                <span className="meta">{window.MD.fmtRelative(r.note.modified)}</span>
              </div>
            ))
          )}
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>⇥</kbd> cycle filter</span>
          <span className="grow"></span>
          <span>{results.length} result{results.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Sidebar, HomePage, NotePage, TagPage, TypePage, SearchPalette });
