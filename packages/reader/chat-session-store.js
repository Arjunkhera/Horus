// Chat Session Store — localStorage-backed session persistence for NLP agent search
(function () {
  const STORE_KEY = 'horus-chat-sessions';
  const MAX_SESSIONS = 50;
  const MAX_MESSAGES = 100;

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function save(store) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) {
      console.warn('ChatSessionStore: localStorage write failed', e);
    }
  }

  function getStore() {
    return load().sessions || {};
  }

  function setStore(sessions) {
    const raw = load();
    raw.sessions = sessions;
    save(raw);
  }

  function getMeta() {
    const raw = load();
    return {
      activeSessionId: raw.activeSessionId || null,
      lastEditorPath: raw.lastEditorPath || '/',
    };
  }

  function setMeta(updates) {
    const raw = load();
    Object.assign(raw, updates);
    save(raw);
  }

  function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function autoTitle(firstMessage) {
    const words = firstMessage.trim().split(/\s+/);
    let title = '';
    for (const w of words) {
      if (title.length + w.length + 1 > 30) break;
      title += (title ? ' ' : '') + w;
    }
    return title.length < firstMessage.trim().length ? title + '…' : title;
  }

  function evictIfNeeded(sessions) {
    const ids = Object.keys(sessions).sort((a, b) =>
      new Date(sessions[a].modified) - new Date(sessions[b].modified)
    );
    while (ids.length >= MAX_SESSIONS) {
      const oldest = ids.find(id => !sessions[id].pinned);
      if (!oldest) break;
      delete sessions[oldest];
      ids.splice(ids.indexOf(oldest), 1);
    }
  }

  const ChatSessionStore = {
    createSession(firstMessage) {
      const sessions = getStore();
      const id = generateId();
      const now = new Date().toISOString();
      evictIfNeeded(sessions);
      sessions[id] = {
        id,
        agentId: null,
        title: firstMessage ? autoTitle(firstMessage) : 'New chat',
        customTitle: null,
        pinned: false,
        created: now,
        modified: now,
        messages: firstMessage ? [{ role: 'user', content: firstMessage, timestamp: now }] : [],
      };
      setStore(sessions);
      return id;
    },

    getSession(id) {
      return getStore()[id] || null;
    },

    listSessions() {
      const sessions = getStore();
      return Object.values(sessions).sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return new Date(b.modified) - new Date(a.modified);
      });
    },

    addUserMessage(id, content) {
      const sessions = getStore();
      if (!sessions[id]) return;
      const now = new Date().toISOString();
      sessions[id].messages = (sessions[id].messages || []).slice(-MAX_MESSAGES + 1);
      sessions[id].messages.push({ role: 'user', content, timestamp: now });
      sessions[id].modified = now;
      setStore(sessions);
    },

    addAssistantMessage(id, content, references, followups) {
      const sessions = getStore();
      if (!sessions[id]) return;
      const now = new Date().toISOString();
      sessions[id].messages = (sessions[id].messages || []).slice(-MAX_MESSAGES + 1);
      sessions[id].messages.push({ role: 'assistant', content, references: references || [], followups: followups || [], timestamp: now });
      sessions[id].modified = now;
      setStore(sessions);
    },

    setAgentId(id, agentId) {
      const sessions = getStore();
      if (!sessions[id]) return;
      sessions[id].agentId = agentId;
      setStore(sessions);
    },

    getAgentId(id) {
      return getStore()[id]?.agentId || null;
    },

    deleteSession(id) {
      const sessions = getStore();
      delete sessions[id];
      setStore(sessions);
      const meta = getMeta();
      if (meta.activeSessionId === id) setMeta({ activeSessionId: null });
    },

    renameSession(id, title) {
      const sessions = getStore();
      if (!sessions[id]) return;
      sessions[id].customTitle = title;
      setStore(sessions);
    },

    pinSession(id) {
      const sessions = getStore();
      if (!sessions[id]) return;
      sessions[id].pinned = true;
      setStore(sessions);
    },

    unpinSession(id) {
      const sessions = getStore();
      if (!sessions[id]) return;
      sessions[id].pinned = false;
      setStore(sessions);
    },

    togglePin(id) {
      const s = getStore()[id];
      if (!s) return;
      s.pinned ? this.unpinSession(id) : this.pinSession(id);
    },

    searchSessions(query) {
      if (!query) return this.listSessions();
      const q = query.toLowerCase();
      return this.listSessions().filter(s => (s.customTitle || s.title).toLowerCase().includes(q));
    },

    getActiveSession() {
      return getMeta().activeSessionId;
    },

    setActiveSession(id) {
      setMeta({ activeSessionId: id });
    },

    setLastEditorPath(path) {
      setMeta({ lastEditorPath: path });
    },

    getLastEditorPath() {
      return getMeta().lastEditorPath || '/';
    },

    getLastActiveSessionId() {
      return getMeta().activeSessionId || (this.listSessions()[0]?.id || null);
    },

    getMessagesForResume(id) {
      const s = getStore()[id];
      if (!s) return [];
      return (s.messages || []).map(m => ({ role: m.role, content: m.content }));
    },

    setScrollPosition(id, pos) {
      const sessions = getStore();
      if (!sessions[id]) return;
      sessions[id]._scrollPosition = pos;
      setStore(sessions);
    },

    getScrollPosition(id) {
      return getStore()[id]?._scrollPosition || 0;
    },
  };

  window.ChatSessionStore = ChatSessionStore;
})();
