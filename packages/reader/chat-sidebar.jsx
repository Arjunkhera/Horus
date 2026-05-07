// ChatSidebar — Chats tab content for the sidebar
(function () {
  const { useState: uS, useEffect: uE, useRef: uR } = React;

  function ChatSidebar({ activeSessionId, onSelectSession, onNewSession }) {
    const store = window.ChatSessionStore;
    const [sessions, setSessions] = uS(() => store.listSessions());
    const [query, setQuery] = uS('');
    const [menuOpen, setMenuOpen] = uS(null); // sessionId with open menu
    const [renaming, setRenaming] = uS(null);
    const menuRef = uR(null);

    uE(() => {
      function refresh() { setSessions(store.listSessions()); }
      window.addEventListener('chat-sessions-updated', refresh);
      return () => window.removeEventListener('chat-sessions-updated', refresh);
    }, []);

    const filtered = query ? store.searchSessions(query) : sessions;

    function groupByDate(list) {
      const today = new Date(); today.setHours(0,0,0,0);
      const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
      const groups = { Today: [], Yesterday: [], Earlier: [] };
      for (const s of list) {
        const d = new Date(s.created); d.setHours(0,0,0,0);
        if (d >= today) groups.Today.push(s);
        else if (d >= yesterday) groups.Yesterday.push(s);
        else groups.Earlier.push(s);
      }
      return groups;
    }

    const pinned = filtered.filter(s => s.pinned);
    const unpinned = filtered.filter(s => !s.pinned);
    const groups = groupByDate(unpinned);

    function handleMenuAction(action, id) {
      const s = store;
      if (action === 'pin') s.togglePin(id);
      else if (action === 'rename') { setRenaming(id); setMenuOpen(null); return; }
      else if (action === 'delete') {
        if (confirm('Delete this chat?')) { s.deleteSession(id); if (activeSessionId === id) onSelectSession(null); }
      }
      setSessions(s.listSessions());
      setMenuOpen(null);
      window.dispatchEvent(new Event('chat-sessions-updated'));
    }

    function handleRename(id, newTitle) {
      if (newTitle.trim()) store.renameSession(id, newTitle.trim());
      setSessions(store.listSessions());
      setRenaming(null);
    }

    function sessionRow(s) {
      const title = s.customTitle || s.title;
      const isActive = s.id === activeSessionId;
      return (
        <div key={s.id} className={`chat-session-row${isActive ? ' active' : ''}`}
          onClick={() => onSelectSession(s.id)}>
          {renaming === s.id
            ? <input autoFocus defaultValue={title} style={{ flex: 1, font: 'inherit', background: 'var(--bg-3)', border: '1px solid var(--nlp)', borderRadius: 2, padding: '0 4px', color: 'inherit' }}
                onBlur={e => handleRename(s.id, e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRename(s.id, e.target.value); if (e.key === 'Escape') setRenaming(null); }} />
            : <span className="chat-session-title">✦ {title}</span>
          }
          {s.pinned && <span style={{ fontSize: 8, color: 'var(--amber)' }}>📌</span>}
          <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', opacity: 0, fontSize: 12, padding: '0 2px' }}
            onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === s.id ? null : s.id); }}>⋯</button>
          {menuOpen === s.id && (
            <div ref={menuRef} style={{ position: 'absolute', right: 4, top: '100%', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 4, zIndex: 100, minWidth: 120, boxShadow: 'var(--shadow-pop)', overflow: 'hidden' }}>
              <button onClick={() => handleMenuAction('pin', s.id)} style={menuItemStyle}>📌 {s.pinned ? 'Unpin' : 'Pin'} chat</button>
              <button onClick={() => handleMenuAction('rename', s.id)} style={menuItemStyle}>✏️ Rename</button>
              <hr style={{ margin: '2px 0', borderColor: 'var(--line)' }} />
              <button onClick={() => handleMenuAction('delete', s.id)} style={{ ...menuItemStyle, color: 'var(--red)' }}>🗑 Delete</button>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="chat-session-list">
        <div className="chat-search-bar">
          <input className="chat-search-input" placeholder="search chats…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <button className="chat-new-btn" onClick={onNewSession}>+ New chat</button>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {pinned.length > 0 && (
            <>
              <div className="chat-date-group">📌 Pinned</div>
              {pinned.map(sessionRow)}
            </>
          )}
          {(['Today', 'Yesterday', 'Earlier']).map(g => groups[g].length > 0 && (
            <React.Fragment key={g}>
              <div className="chat-date-group">{g}</div>
              {groups[g].map(sessionRow)}
            </React.Fragment>
          ))}
          {filtered.length === 0 && <div style={{ padding: 12, color: 'var(--ink-3)', font: '400 10px/1.4 var(--font-mono)', textAlign: 'center' }}>No chats yet</div>}
        </div>
      </div>
    );
  }

  const menuItemStyle = {
    display: 'block', width: '100%', padding: '6px 10px',
    background: 'transparent', border: 'none', cursor: 'pointer',
    font: '400 10px/1 var(--font-mono)', color: 'var(--ink)', textAlign: 'left',
  };

  window.ChatSidebar = ChatSidebar;
})();
