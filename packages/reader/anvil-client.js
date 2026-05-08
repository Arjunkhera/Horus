// Anvil REST client for the Reader SPA.
// Exposes window.AnvilClient — a thin fetch wrapper over the REST routes
// added to Anvil's HTTP transport (GET /api/notes/:id, GET /api/notes/:id/edges, POST /api/search).
// All methods throw on network errors; callers should catch and degrade gracefully.
(function () {
  const BASE = (window.ANVIL_BASE_URL || 'http://localhost:8100').replace(/\/$/, '');

  async function apiFetch(path, opts) {
    const res = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const data = await res.json();
    // Anvil error shape: { error: true, code, message }
    if (data && data.error === true) {
      const err = new Error(data.message || 'Anvil error');
      err.code = data.code;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  window.AnvilClient = {
    /** Check Anvil reachability. Returns true/false — never throws. */
    async ping() {
      try {
        const r = await fetch(BASE + '/health', { signal: AbortSignal.timeout(3000) });
        return r.ok;
      } catch {
        return false;
      }
    },

    /** Fetch a full note with body, metadata, and SQLite relationships. */
    getNote(id) {
      return apiFetch('/api/notes/' + encodeURIComponent(id));
    },

    /** Fetch Neo4j edges for a note, optionally filtered by intent. */
    getEdges(id, intent) {
      const qs = intent ? '?intent=' + encodeURIComponent(intent) : '';
      return apiFetch('/api/notes/' + encodeURIComponent(id) + '/edges' + qs);
    },

    /**
     * Search notes via Typesense + SQLite.
     * @param {object} params - SearchV2Input: { query?, type?, filters?, limit?, offset? }
     */
    search(params) {
      return apiFetch('/api/search', {
        method: 'POST',
        body: JSON.stringify(params || {}),
      });
    },

    /**
     * Fetch notes modified after `since` (ISO string) for gap recovery.
     * Uses modified_after filter — supported by handleSearchV2.
     */
    deltaFetch(since) {
      return apiFetch('/api/search', {
        method: 'POST',
        body: JSON.stringify({ filters: { modified_after: since }, limit: 100 }),
      });
    },

    /** Delete a note by ID. Returns { ok: true } on success, throws on error. */
    deleteNote(id) {
      return apiFetch('/api/notes/' + encodeURIComponent(id), { method: 'DELETE' });
    },

    /** Update a note body. Returns { ok: true } on success, throws on error. */
    updateNote(id, body) {
      return apiFetch('/api/notes/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      });
    },

    /**
     * Open an SSE connection to /api/events.
     * @param {{ onEvent: (e) => void, onReconnect: () => void }} handlers
     * @returns {EventSource}
     */
    connectSSE(handlers) {
      const es = new EventSource(BASE + '/api/events');
      es.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data);
          if (event.type !== 'connected') handlers.onEvent(event);
        } catch {}
      };
      es.onerror = () => {
        if (handlers.onReconnect) handlers.onReconnect();
      };
      return es;
    },
  };
})();
