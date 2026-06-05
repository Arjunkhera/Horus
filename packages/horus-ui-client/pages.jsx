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

// ── System status ────────────────────────────────────────────────
// Per-service health from GET /api/system/status. horus-ui boots independently,
// so this surfaces backing-service state and gates remote tabs in local-only.
function SystemStatus() {
  const [status, setStatus] = uSp(null);
  const [loading, setLoading] = uSp(true);

  uEp(() => {
    let alive = true;
    function load() {
      fetch('/api/system/status')
        .then(r => r.json())
        .then(s => { if (alive) { setStatus(s); setLoading(false); } })
        .catch(() => { if (alive) setLoading(false); });
    }
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  function dotClass(st) {
    if (st === 'connected') return 'ok';
    if (st === 'degraded' || st === 'unknown') return 'warn';
    if (st === 'not_configured') return 'muted';
    return 'err';
  }
  function Row({ st, label, note }) {
    return (
      <div className="side-status-row">
        <span className={`status-dot ${dotClass(st)}`} />
        <span className="ss-label">{label}</span>
        {note && <span className="ss-note">{note}</span>}
      </div>
    );
  }

  return (
    <div className="side-status">
      <div className="side-status-head">
        System{status ? <span className="ss-mode"> · {status.mode}</span> : ''}
      </div>
      {loading && !status && <div className="side-status-row muted">checking services…</div>}
      {status && (
        <>
          <Row st={status.services.anvil.status} label="Anvil" note={status.services.anvil.detail} />
          <Row st={status.services.typesense.status} label="Typesense" />
          <Row st={status.services.neo4j.status} label="Neo4j" />
          <Row
            st={status.services.control_plane.status}
            label="Control plane"
            note={status.services.control_plane.status === 'not_configured' ? 'not configured' : null}
          />
          {status.mode === 'local-only' && (
            <div className="side-status-row muted" title="Configure a control plane in Settings to enable these">
              Vault · Forge · Admin — not configured
            </div>
          )}
        </>
      )}
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

// Config-driven icon row — actions: [{ icon, label, onClick, disabled?, active?, danger? }]
function PageActions({ actions }) {
  return (
    <div className="page-actions">
      {actions.map(({ icon, label, onClick, disabled, active, danger }) => (
        <button
          key={label}
          className={['action-icon', disabled && 'disabled', active && 'active', danger && 'danger'].filter(Boolean).join(' ')}
          onClick={disabled ? undefined : onClick}
          title={label}
          aria-disabled={disabled || false}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

// ── Type ordering ────────────────────────────────────────────────
const TYPE_ORDER = ['task', 'story', 'note', 'journal', 'project', 'area', 'bookmark', 'conversation-state', 'person', 'service', 'meeting', 'repo-profile', 'guide', 'concept', 'procedure', 'keystone', 'learning'];
// Returns all types that have ≥1 note: known types first (TYPE_ORDER), then extras by count
function activeTypes(counts) {
  const known = TYPE_ORDER.filter(t => counts[t] > 0);
  const extra = Object.keys(counts).filter(t => counts[t] > 0 && !TYPE_ORDER.includes(t))
    .sort((a, b) => counts[b] - counts[a]);
  return [...known, ...extra];
}

// ── Sidebar ──────────────────────────────────────────────────────
const SIDE_LIMIT = 8; // static cap for Phase 1
function Sidebar({ recents, currentRoute, onNavigate, typeCounts, collapsed, pinned, togglePin, lastSyncedAt, onRefresh, scope }) {
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

  if (scope === 'vault') {
    return <VaultSidebar currentRoute={currentRoute} onNavigate={onNavigate} collapsed={collapsed} />;
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

      <SystemStatus />
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

      {/* NLP Ask Bar — hidden when the agent chat is disabled (no Anthropic key) */}
      {window.HORUS_AI_ENABLED !== false && (
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
      )}

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
  const [deleteOpen, setDeleteOpen] = uSp(false);
  const [deleteLoading, setDeleteLoading] = uSp(false);
  const [deleteError, setDeleteError] = uSp(null);
  // EDIT-5: Obsidian-style inline editor state
  const [editMode, setEditMode] = uSp(false);
  const [editBody, setEditBody] = uSp('');
  const [lastSavedBody, setLastSavedBody] = uSp('');
  const [saveStatus, setSaveStatus] = uSp('idle'); // 'idle'|'saving'|'saved'|'error'
  const autoSaveRef = uRp(null);
  const editBodyRef = uRp('');
  const lastSavedBodyRef = uRp('');
  // EDIT-3: journal append editor state
  const [appendMode, setAppendMode] = uSp(false);
  const [appendBody, setAppendBody] = uSp('');
  const [appendSaving, setAppendSaving] = uSp(false);
  const [appendError, setAppendError] = uSp(null);
  // Version counter to force useNote refetch after save/append
  const [noteVersion, setNoteVersion] = uSp(0);

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

  function openEditor(currentBody) {
    const body = currentBody || '';
    editBodyRef.current = body;
    lastSavedBodyRef.current = body;
    setEditBody(body);
    setLastSavedBody(body);
    setSaveStatus('idle');
    setEditMode(true);
  }

  async function handleSave(bodyToSave) {
    setSaveStatus('saving');
    try {
      await window.AnvilClient.updateNote(noteId, bodyToSave);
      const fresh = await window.AnvilClient.getNote(noteId);
      if (fresh) {
        const merged = { ...data.byId[noteId], ...fresh, id: fresh.noteId || fresh.id || noteId };
        data.byId[noteId] = merged;
        if (merged.title) data.byTitle[merged.title.toLowerCase()] = noteId;
      }
      if (HOOKS) HOOKS.invalidate('note:' + noteId);
      setNoteVersion(v => v + 1);
      lastSavedBodyRef.current = bodyToSave;
      setLastSavedBody(bodyToSave);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 2000);
      return true;
    } catch {
      setSaveStatus('error');
      return false;
    }
  }

  async function closeEditor() {
    if (autoSaveRef.current) {
      clearTimeout(autoSaveRef.current);
      autoSaveRef.current = null;
    }
    if (editBodyRef.current !== lastSavedBodyRef.current) {
      const saved = await handleSave(editBodyRef.current);
      if (!saved) return;
    }
    setEditMode(false);
    setEditBody('');
    setSaveStatus('idle');
  }

  async function handleAppend() {
    if (!appendBody.trim()) return;
    setAppendSaving(true);
    setAppendError(null);
    const today = new Date().toISOString().slice(0, 10);
    const entry = `## ${today}\n${appendBody}`;
    try {
      await window.AnvilClient.updateNote(noteId, entry);
      const fresh = await window.AnvilClient.getNote(noteId);
      if (fresh) {
        const merged = { ...data.byId[noteId], ...fresh, id: fresh.noteId || fresh.id || noteId };
        data.byId[noteId] = merged;
        if (merged.title) data.byTitle[merged.title.toLowerCase()] = noteId;
      }
      if (HOOKS) HOOKS.invalidate('note:' + noteId);
      setNoteVersion(v => v + 1);
      setAppendMode(false);
      setAppendBody('');
    } catch (err) {
      setAppendError(err?.message || 'Append failed. Please try again.');
    } finally {
      setAppendSaving(false);
    }
  }

  // Fetch full note content from Anvil (falls back to mock data when offline)
  const { data: liveNote, loading: noteLoading } = HOOKS
    ? HOOKS.useNote(noteId, noteVersion)
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

  // Warn on tab close only when there are unsaved changes
  uEp(() => {
    if (!editMode) return;
    function onBeforeUnload(e) {
      if (editBodyRef.current === lastSavedBodyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [editMode]);

  // Auto-save: 1500ms debounce after last keystroke
  uEp(() => {
    if (!editMode || editBody === lastSavedBodyRef.current) return;
    const body = editBody;
    const timer = setTimeout(() => handleSave(body), 1500);
    autoSaveRef.current = timer;
    return () => clearTimeout(timer);
  }, [editBody, editMode]);

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
          {editMode && <span className="editing-badge">Editing</span>}
          <PageActions actions={[
            {
              icon: <window.Icon.Pin filled={isPinned} />,
              label: isPinned ? 'Unpin from sidebar' : 'Pin to sidebar',
              onClick: () => togglePin(noteId),
              active: isPinned,
            },
            {
              icon: <window.Icon.Pencil />,
              label: editMode ? 'Save & exit' : note.type === 'journal' ? 'Journals are append-only' : note.type === 'conversation-state' ? 'System notes cannot be edited' : 'Edit',
              onClick: editMode ? () => closeEditor() : () => openEditor(note.body || ''),
              active: editMode,
              disabled: !editMode && (note.type === 'journal' || note.type === 'conversation-state'),
            },
            {
              icon: <window.Icon.Trash />,
              label: note.type === 'conversation-state' ? 'System notes cannot be deleted' : 'Delete',
              onClick: () => setDeleteOpen(true),
              disabled: note.type === 'conversation-state',
              danger: true,
            },
          ]} />
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

        {editMode ? (
          <div className="inline-editor">
            <div className="inline-editor-hint">
              ⚠ Wiki-links (<code>[[...]]</code>) should not be modified to preserve note relationships.
            </div>
            <textarea
              className="inline-editor-textarea"
              value={editBody}
              onChange={e => {
                const v = e.target.value;
                editBodyRef.current = v;
                setEditBody(v);
                e.target.style.height = 'auto';
                e.target.style.height = Math.max(300, e.target.scrollHeight) + 'px';
              }}
              onKeyDown={e => { if (e.key === 'Escape') closeEditor(); }}
              ref={el => {
                if (el) { el.style.height = 'auto'; el.style.height = Math.max(300, el.scrollHeight) + 'px'; el.focus(); }
              }}
            />
            <div className="inline-editor-actions">
              <span className={`save-status${saveStatus !== 'idle' ? ' ' + saveStatus : ''}`}>
                {saveStatus === 'idle' && editBody !== lastSavedBody ? 'Unsaved' : ''}
                {saveStatus === 'saving' && 'Saving…'}
                {saveStatus === 'saved' && 'Saved ✓'}
                {saveStatus === 'error' && (
                  <span>⚠ Save failed · <button className="retry-btn" onClick={() => handleSave(editBodyRef.current)}>Retry</button></span>
                )}
              </span>
            </div>
          </div>
        ) : (
          <article
            className={`md${note.type !== 'journal' && note.type !== 'conversation-state' ? ' editable' : ''}`}
          >
            <window.MD.MarkdownBody
              body={note.body}
              onNavigate={(id) => {
                if (editMode && editBodyRef.current !== lastSavedBodyRef.current && !window.confirm('You have unsaved changes. Leave anyway?')) return;
                onNavigate({ kind: 'note', id });
              }}
            />
          </article>
        )}

        {note.type === 'journal' && !appendMode && (
          <button className="journal-append-btn" onClick={() => { setAppendBody(''); setAppendError(null); setAppendMode(true); }}>
            + Add Entry
          </button>
        )}

        {note.type === 'journal' && appendMode && (
          <div className="inline-editor append-editor">
            <textarea
              className="inline-editor-textarea"
              placeholder="Add a new journal entry…"
              value={appendBody}
              onChange={e => {
                setAppendBody(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = Math.max(150, e.target.scrollHeight) + 'px';
              }}
              ref={el => {
                if (el) { el.style.height = 'auto'; el.style.height = Math.max(150, el.scrollHeight) + 'px'; el.focus(); }
              }}
            />
            {appendError && <div className="inline-editor-error">{appendError}</div>}
            <div className="inline-editor-actions">
              <button className="chip" onClick={() => { setAppendMode(false); setAppendBody(''); setAppendError(null); }} disabled={appendSaving}>Cancel</button>
              <button className="chip active save-btn" onClick={handleAppend} disabled={appendSaving || !appendBody.trim()}>
                {appendSaving ? 'Saving…' : 'Append entry'}
              </button>
            </div>
          </div>
        )}
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
function SearchPalette({ onClose, onNavigate, scope }) {
  const [q, setQ] = uSp('');
  const [debouncedQ, setDebouncedQ] = uSp('');
  const [filter, setFilter] = uSp(null);
  const [active, setActive] = uSp(0);
  const inputRef = uRp();
  const data = window.HORUS_DATA;
  const HOOKS = window.HOOKS;

  // Vault-scoped search state (used when scope === 'vault')
  const [vaultSearchResults, setVaultSearchResults] = uSp([]);
  const [vaultSearchLoading, setVaultSearchLoading] = uSp(false);

  // Debounce search query by 150ms
  uEp(() => {
    const t = setTimeout(() => setDebouncedQ(q), 150);
    return () => clearTimeout(t);
  }, [q]);

  // Live search via Anvil using debounced query (skip while in vault scope)
  const anvilQuery = scope === 'vault' ? '' : debouncedQ.trim();
  const liveSearch = HOOKS ? HOOKS.useSearch(anvilQuery, filter, 12) : { data: null, loading: false };

  // Vault-scoped search: query the active vault via VaultClient when in vault scope
  uEp(() => {
    if (scope !== 'vault') { setVaultSearchResults([]); setVaultSearchLoading(false); return; }
    const query = debouncedQ.trim();
    if (!query) { setVaultSearchResults([]); setVaultSearchLoading(false); return; }
    let cancelled = false;
    setVaultSearchLoading(true);
    const vault = (window.VAULT_STATE && window.VAULT_STATE.selectedVault) || '';
    window.VaultClient.search({ query, vault, limit: 12 })
      .then(res => { if (!cancelled) { setVaultSearchResults((res && res.results) || []); setVaultSearchLoading(false); } })
      .catch(() => { if (!cancelled) { setVaultSearchResults([]); setVaultSearchLoading(false); } });
    return () => { cancelled = true; };
  }, [scope, debouncedQ]);

  uEp(() => {
    inputRef.current?.focus();
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const results = uMp(() => {
    if (scope === 'vault') {
      if (!q.trim()) return [];
      return vaultSearchResults.map(r => ({
        note: { id: r.id, type: r.type, title: r.title, tags: r.tags || [], modified: '', body: '' },
        score: r.score || 0,
        snippet: r.description || r.snippet || '',
        isVault: true,
      }));
    }
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
  }, [q, debouncedQ, filter, liveSearch.data, scope, vaultSearchResults]);

  uEp(() => { setActive(0); }, [q, filter]);

  function open(idx) { const r = results[idx]; if (!r) return; if (r.isVault) { onNavigate({ kind: 'vault-page', id: r.note.id }); } else { onNavigate({ kind: 'note', id: r.note.id }); } onClose(); }
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
          {scope === 'vault' ? (
            <span className="filter-label" style={{ color: 'var(--fg-3)' }}>Vault search{vaultSearchLoading ? ' …' : ''}</span>
          ) : (
            <>
              <span className="filter-label">FILTER:</span>
              <button className={`chip${filter === null ? ' active' : ''}`} onClick={() => setFilter(null)}>all</button>
              {activeTypes(data.typeCounts()).map(t => (
                <button key={t} className={`chip${filter === t ? ' active' : ''}`} onClick={() => setFilter(t)}>
                  <span className={`type-dot ${t}`} style={{ width: 6, height: 6, display: 'inline-block', borderRadius: '50%' }}></span>
                  {t}
                </button>
              ))}
            </>
          )}
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

Object.assign(window, { Sidebar, HomePage, NotePage, TagPage, TypePage, SearchPalette, VaultContentArea });


// ── Vault types ───────────────────────────────────────────────────────────────
// These map to the canonical page types in the Vault knowledge base.
const VAULT_TYPES = ['repo-profile', 'guide', 'concept', 'procedure', 'keystone', 'learning'];
const VAULT_MODES = ['reference', 'operational', 'keystone'];

// ── Shared VAULT_STATE window object ─────────────────────────────────────────
// Shared between VaultSidebar and VaultContentArea to avoid duplicate fetches.
// Shape: { selectedVault, vaults, defaultVault, pages, loading, error }
if (!window.VAULT_STATE) {
  window.VAULT_STATE = {
    selectedVault: '',
    vaults: [],
    defaultVault: '',
    pages: [],
    loading: false,
    error: null,
    listeners: [],
    notify() { this.listeners.forEach(fn => fn()); },
    subscribe(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter(l => l !== fn); }; },
  };
}

// ── VaultSidebar ─────────────────────────────────────────────────────────────
function VaultSidebar({ currentRoute, onNavigate, collapsed }) {
  const vs = window.VAULT_STATE;
  const [, forceUpdate] = uSp(0);

  // Subscribe to VAULT_STATE changes
  uEp(() => vs.subscribe(() => forceUpdate(v => v + 1)), []);

  // Load vaults once
  uEp(() => {
    if (vs.vaults.length > 0 || vs.loading) return;
    vs.loading = true;
    vs.notify();
    window.VaultClient.listVaults()
      .then(data => {
        vs.vaults = data.vaults || [];
        vs.defaultVault = data.default_vault || '';
        if (!vs.selectedVault) vs.selectedVault = data.default_vault || (vs.vaults[0] && vs.vaults[0].namespace) || '';
        vs.error = null;
      })
      .catch(err => { vs.error = err.message; })
      .finally(() => { vs.loading = false; vs.notify(); });
  }, []);

  // Load pages when selectedVault changes (guarded against rapid-switch races)
  uEp(() => {
    if (!vs.selectedVault) return;
    let cancelled = false;
    const forVault = vs.selectedVault;
    vs.pages = [];
    vs.loading = true;
    vs.notify();
    // The vault writer caps /list-by-scope at limit<=100; a higher value 422s,
    // which the router swallows into an empty 200 → the vault renders "0 pages".
    window.VaultClient.listPages({ vault: forVault, limit: 100 })
      .then(data => { if (cancelled || vs.selectedVault !== forVault) return; vs.pages = data.pages || []; vs.error = null; })
      .catch(err => { if (cancelled || vs.selectedVault !== forVault) return; vs.error = err.message; })
      .finally(() => { if (cancelled || vs.selectedVault !== forVault) return; vs.loading = false; vs.notify(); });
    return () => { cancelled = true; };
  }, [vs.selectedVault]);

  function selectVault(namespace) {
    vs.selectedVault = namespace;
    vs.pages = [];
    vs.notify();
    onNavigate({ kind: 'vault-home', vault: namespace });
  }

  if (collapsed) {
    return (
      <aside className="side collapsed">
        <div className="side-rail">
          <button className="side-rail-btn" title="Vault home" onClick={() => onNavigate({ kind: 'vault-home', vault: vs.selectedVault })}>⬡</button>
          {VAULT_TYPES.map(t => (
            <button key={t} className="side-rail-btn" title={t} onClick={() => onNavigate({ kind: 'vault-type', vault: vs.selectedVault, type: t })}>
              <span className={`type-dot ${t}`}></span>
            </button>
          ))}
        </div>
      </aside>
    );
  }

  // Derive type counts and tag counts from pages
  const typeCounts = {};
  vs.pages.forEach(p => { if (p.type) typeCounts[p.type] = (typeCounts[p.type] || 0) + 1; });
  const tagCounts = {};
  vs.pages.forEach(p => (p.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const activeVaultTypes = VAULT_TYPES.filter(t => typeCounts[t] > 0)
    .concat(Object.keys(typeCounts).filter(t => typeCounts[t] > 0 && !VAULT_TYPES.includes(t)));

  return (
    <aside className="side">
      {/* Vault selector */}
      <div className="vault-selector-sidebar">
        {vs.vaults.length > 1 && (
          <select
            className="vault-select-inline"
            value={vs.selectedVault}
            onChange={e => selectVault(e.target.value)}
            title="Select vault"
          >
            {vs.vaults.map(v => (
              <option key={v.namespace} value={v.namespace}>
                {v.namespace}{v.namespace === vs.defaultVault ? ' ✓' : ''}
              </option>
            ))}
          </select>
        )}
        {vs.vaults.length <= 1 && vs.selectedVault && (
          <div className="vault-selector-name" onClick={() => onNavigate({ kind: 'vault-home', vault: vs.selectedVault })}>
            <span className="vault-selector-icon">⬡</span>
            <span className="label">{vs.selectedVault}</span>
          </div>
        )}
        {vs.loading && !vs.selectedVault && <div className="side-empty">Loading vaults…</div>}
        {vs.error && <div className="side-empty" style={{ color: 'var(--red)' }}>Error loading vaults</div>}
      </div>

      {/* Browse by type */}
      <SideSection id="vault-types" title="Browse by type">
        {vs.loading && vs.pages.length === 0
          ? <div className="side-empty">Loading…</div>
          : activeVaultTypes.length === 0
            ? <div className="side-empty">No pages yet</div>
            : activeVaultTypes.map(t => {
                const isActive = currentRoute.kind === 'vault-type' && currentRoute.type === t;
                return (
                  <button key={t} className={`side-link${isActive ? ' active' : ''}`} onClick={() => onNavigate({ kind: 'vault-type', vault: vs.selectedVault, type: t })}>
                    <span className={`type-dot ${t}`} />
                    <span className="label">{t}</span>
                    <span className="meta">{typeCounts[t] || 0}</span>
                  </button>
                );
              })}
      </SideSection>

      {/* Top tags */}
      <SideSection id="vault-tags" title="Top tags" defaultOpen={false}>
        {topTags.length === 0
          ? <div className="side-empty">No tags</div>
          : topTags.map(([t, c]) => {
              const isActive = currentRoute.kind === 'vault-type' && currentRoute.tag === t;
              return (
                <button key={t} className={`side-link${isActive ? ' active' : ''}`} onClick={() => onNavigate({ kind: 'vault-type', vault: vs.selectedVault, tag: t })}>
                  <span style={{ color: 'var(--fg-3)', width: 10, fontFamily: 'var(--font-mono)' }}>#</span>
                  <span className="label">{t}</span>
                  <span className="meta">{c}</span>
                </button>
              );
            })}
      </SideSection>

      <SystemStatus />
    </aside>
  );
}

// ── VaultContentArea — routes vault-home / vault-type / vault-page ────────────
function VaultContentArea({ route, onNavigate }) {
  if (route.kind === 'vault-home') return <VaultHomePage vault={route.vault} onNavigate={onNavigate} />;
  if (route.kind === 'vault-type') return <VaultTypeListPage vault={route.vault} type={route.type} tag={route.tag} onNavigate={onNavigate} />;
  if (route.kind === 'vault-page') return <VaultDetailPage pageId={route.id} onNavigate={onNavigate} />;
  return <VaultHomePage vault={''} onNavigate={onNavigate} />;
}

// ── VaultHomePage — browse-by-type grid for the selected vault ────────────────
function VaultHomePage({ vault, onNavigate }) {
  const vs = window.VAULT_STATE;
  const [, forceUpdate] = uSp(0);
  uEp(() => vs.subscribe(() => forceUpdate(v => v + 1)), []);

  // Sync vault selector to route-supplied vault
  uEp(() => {
    if (vault && vault !== vs.selectedVault) {
      vs.selectedVault = vault;
      vs.notify();
    }
  }, [vault]);

  const pages = vs.pages;
  const typeCounts = {};
  pages.forEach(p => { if (p.type) typeCounts[p.type] = (typeCounts[p.type] || 0) + 1; });

  const orderedTypes = VAULT_TYPES.filter(t => typeCounts[t] > 0)
    .concat(Object.keys(typeCounts).filter(t => !VAULT_TYPES.includes(t) && typeCounts[t] > 0));

  const vaultName = vs.selectedVault || vault || 'Vault';

  return (
    <div className="main-inner">
      <div className="greeting">
        <h2>⬡ {vaultName}</h2>
        <div className="sub">{pages.length} page{pages.length !== 1 ? 's' : ''} · read-only knowledge base</div>
      </div>

      {vs.loading && pages.length === 0 && (
        <div className="empty loading">Loading pages…</div>
      )}
      {vs.error && (
        <div className="empty" style={{ color: 'var(--red)' }}>Error: {vs.error}</div>
      )}

      {orderedTypes.length > 0 && (
        <div className="home-section">
          <div className="home-section-head static">
            <span className="t">Browse by type</span>
            <span className="c">{pages.length}</span>
          </div>
          <div className="type-strip">
            {orderedTypes.map(t => (
              <button key={t} className="type-tile" onClick={() => onNavigate({ kind: 'vault-type', vault: vs.selectedVault, type: t })}>
                <div className="row">
                  <span className={`type-dot ${t}`} />
                  <span className="label">{t}</span>
                </div>
                <span className="count">{typeCounts[t] || 0}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {orderedTypes.length === 0 && !vs.loading && (
        <div className="empty">No pages in this vault.</div>
      )}
    </div>
  );
}

// ── VaultTypeListPage — list pages of a type (or tag) ──────────────────────────
function VaultTypeListPage({ vault, type, tag, onNavigate }) {
  const vs = window.VAULT_STATE;
  const [, forceUpdate] = uSp(0);
  const [filterMode, setFilterMode] = uSp('');
  const [filterText, setFilterText] = uSp('');

  uEp(() => vs.subscribe(() => forceUpdate(v => v + 1)), []);

  // Sync vault selector to route-supplied vault (multi-vault deep-link / history)
  uEp(() => {
    if (vault && vault !== vs.selectedVault) {
      vs.selectedVault = vault;
      vs.notify();
    }
  }, [vault]);

  const pages = vs.pages;
  const filtered = uMp(() => {
    let arr = pages;
    if (type) arr = arr.filter(p => p.type === type);
    if (tag) arr = arr.filter(p => (p.tags || []).includes(tag));
    if (filterMode) arr = arr.filter(p => p.mode === filterMode);
    if (filterText) {
      const q = filterText.toLowerCase();
      arr = arr.filter(p => ((p.title || '') + ' ' + (p.description || '')).toLowerCase().includes(q));
    }
    return arr;
  }, [pages, type, tag, filterMode, filterText]);

  const headLabel = tag ? `#${tag}` : (type || 'All pages');

  return (
    <div className="main-inner wide">
      <div className="list-head">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {type && <span className={`type-dot ${type}`} style={{ width: 12, height: 12 }}></span>}
          {headLabel}
          <span style={{ color: 'var(--fg-3)', fontSize: 18, fontFamily: 'var(--font-mono)' }}>· {filtered.length}</span>
        </h2>
      </div>

      <div className="sort-bar">
        <span className="filter-label">MODE:</span>
        <button className={`chip${filterMode === '' ? ' active' : ''}`} onClick={() => setFilterMode('')}>all</button>
        {VAULT_MODES.map(m => (
          <button key={m} className={`chip${filterMode === m ? ' active' : ''}`} onClick={() => setFilterMode(m)}>{m}</button>
        ))}
        <input
          className="vault-text-filter"
          type="text"
          placeholder="Filter…"
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
        />
      </div>

      {vs.loading && pages.length === 0 && <div className="empty">Loading…</div>}
      {filtered.length === 0 && !vs.loading && <div className="empty">No pages match.</div>}

      <div className="ref-list">
        {filtered.map(p => (
          <div key={p.id} className="ref-row" onClick={() => onNavigate({ kind: 'vault-page', id: p.id })}>
            <window.MD.TypePill type={p.type} />
            <div>
              <div className="title">{p.title}</div>
              <div className="snippet">
                {p.description || ''}
                {(p.tags || []).length > 0 && (
                  <span> {(p.tags || []).map(t => <span key={t} className="chip tag" style={{ fontSize: 10, padding: '1px 6px' }}>{t}</span>)}</span>
                )}
              </div>
            </div>
            <span className="meta">{p.mode || ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── VaultDetailPage — single vault page ──────────────────────────────────────
function VaultDetailPage({ pageId, onNavigate }) {
  const [page, setPage] = uSp(null);
  const [loading, setLoading] = uSp(true);
  const [error, setError] = uSp(null);

  uEp(() => {
    setLoading(true);
    setError(null);
    setPage(null);
    // Pass the active vault as a hint so the router goes straight to the owning
    // vault; when browsing "all" (empty), the router resolves / fans out.
    window.VaultClient.getPage(pageId, (window.VAULT_STATE && window.VAULT_STATE.selectedVault) || undefined)
      .then(data => setPage(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [pageId]);

  if (loading) return <div className="main-inner"><div className="empty loading">Loading page…</div></div>;
  if (error) return <div className="main-inner"><div className="empty" style={{ color: 'var(--red)' }}>Error: {error}</div></div>;
  if (!page) return <div className="main-inner"><div className="empty">Page not found.</div></div>;

  return (
    <div className="main-inner">
      <header className={`note-header type-${page.type}`}>
        <div className="note-meta-row">
          <window.MD.TypePill type={page.type} />
          {page.mode && <span className="chip">{page.mode}</span>}
        </div>
        <h1 className="note-title">{page.title}</h1>
        {(page.tags || []).length > 0 && (
          <div className="note-tags">
            {(page.tags || []).map(t => (
              <button key={t} className="chip tag" onClick={() => onNavigate({ kind: 'vault-type', vault: window.VAULT_STATE.selectedVault || '', tag: t })}>{t}</button>
            ))}
          </div>
        )}
        {page.description && (
          <p style={{ color: 'var(--fg-2)', fontSize: 14, margin: '10px 0 0 0', lineHeight: 1.5 }}>{page.description}</p>
        )}
      </header>

      {/* Scope rail block */}
      {page.scope && (page.scope.program || page.scope.repo) && (
        <div className="note-layout" style={{ padding: '0', marginBottom: 0 }}>
          <div></div>
          <aside className="note-rail" style={{ marginTop: 0 }}>
            <div className="rail-inner">
              <div className="rail-block">
                <div className="rail-block-title">Scope</div>
                {page.scope.program && <div className="kv"><span className="k">program</span><span className="v">{page.scope.program}</span></div>}
                {page.scope.repo && <div className="kv"><span className="k">repo</span><span className="v">{page.scope.repo}</span></div>}
              </div>
            </div>
          </aside>
        </div>
      )}

      <article className="md">
        {page.body
          ? <window.MD.MarkdownBody body={page.body} onNavigate={() => {}} />
          : <div className="empty" style={{ padding: '16px 0' }}>No content.</div>
        }
      </article>
    </div>
  );
}
