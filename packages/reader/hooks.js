// React hooks for Anvil data fetching with 5-minute TTL cache.
// Requires window.AnvilClient to be loaded first.
// Exposes window.HOOKS = { useNote, useEdges, useSearch, invalidate }.
(function () {
  const { useState, useEffect, useRef } = React;

  // Simple request-level cache: key → { data, ts }
  const CACHE = new Map();
  const TTL_MS = 5 * 60 * 1000;

  function getCached(key) {
    const entry = CACHE.get(key);
    if (entry && Date.now() - entry.ts < TTL_MS) return entry.data;
    return null;
  }

  function setCached(key, data) {
    CACHE.set(key, { data, ts: Date.now() });
  }

  function invalidate(pattern) {
    if (!pattern) {
      CACHE.clear();
      return;
    }
    for (const key of CACHE.keys()) {
      if (key.startsWith(pattern)) CACHE.delete(key);
    }
  }

  /**
   * Generic async data hook.
   * Returns { data, loading, error }.
   * Re-runs when any dep changes; cancels in-flight fetch on cleanup.
   */
  function useAsync(fetchFn, deps) {
    const [state, setState] = useState({ data: null, loading: true, error: null });
    const cancelRef = useRef(false);

    useEffect(() => {
      cancelRef.current = false;
      setState({ data: null, loading: true, error: null });

      fetchFn()
        .then((data) => {
          if (!cancelRef.current) setState({ data, loading: false, error: null });
        })
        .catch((err) => {
          if (!cancelRef.current) setState({ data: null, loading: false, error: err });
        });

      return () => {
        cancelRef.current = true;
      };
    }, deps);

    return state;
  }

  /**
   * Fetch a full note (body + metadata + SQLite relationships).
   * Falls back to data.byId[id] when AnvilClient is unavailable.
   * @param {string} id
   * @returns {{ data: NoteWithRelationships|null, loading: boolean, error: Error|null }}
   */
  function useNote(id) {
    return useAsync(() => {
      if (!id) return Promise.resolve(null);
      const cached = getCached('note:' + id);
      if (cached) return Promise.resolve(cached);
      if (!window.AnvilClient) {
        // Offline: return mock data if available
        const mock = window.HORUS_DATA?.byId?.[id] ?? null;
        return Promise.resolve(mock);
      }
      return window.AnvilClient.getNote(id).then((note) => {
        setCached('note:' + id, note);
        return note;
      });
    }, [id]);
  }

  /**
   * Fetch Neo4j edges for a note.
   * Falls back to data.getEdges(id) when AnvilClient is unavailable.
   * @param {string} id
   * @param {string} [intent] - optional intent filter
   * @returns {{ data: GetEdgesOutput|null, loading: boolean, error: Error|null }}
   */
  function useEdges(id, intent) {
    return useAsync(() => {
      if (!id) return Promise.resolve(null);
      const key = 'edges:' + id + ':' + (intent || '');
      const cached = getCached(key);
      if (cached) return Promise.resolve(cached);
      if (!window.AnvilClient) {
        // Offline: synthesize from mock edge store
        const raw = window.HORUS_DATA?.getEdges?.(id);
        if (!raw) return Promise.resolve({ noteId: id, edges: [], total: 0 });
        const edges = [
          ...raw.out.map((e) => ({ sourceId: e.from, targetId: e.to, intent: e.intent, direction: 'outgoing', displayLabel: e.intent })),
          ...(raw.in || []).map((e) => ({ sourceId: e.from, targetId: e.to, intent: e.intent, direction: 'incoming', displayLabel: e.intent })),
        ];
        return Promise.resolve({ noteId: id, edges, total: edges.length });
      }
      return window.AnvilClient.getEdges(id, intent).then((result) => {
        setCached(key, result);
        return result;
      });
    }, [id, intent || null]);
  }

  /**
   * Full-text search over Anvil notes.
   * Falls back to data.search() when AnvilClient is unavailable.
   * @param {string} query
   * @param {string|null} typeFilter
   * @param {number} [limit]
   * @returns {{ data: SearchV2Response|null, loading: boolean, error: Error|null }}
   */
  function useSearch(query, typeFilter, limit) {
    const l = limit || 20;
    return useAsync(() => {
      const trimmed = (query || '').trim();
      const key = 'search:' + trimmed + ':' + (typeFilter || '') + ':' + l;
      const cached = getCached(key);
      if (cached) return Promise.resolve(cached);

      if (!window.AnvilClient) {
        // Offline: run mock search and adapt format
        const hits = window.HORUS_DATA?.search?.(trimmed, typeFilter) || [];
        const results = hits.slice(0, l).map((h) => ({
          id: h.note.id,
          type: h.note.type,
          title: h.note.title,
          snippet: h.snippet || '',
          matched_fields: [],
          score: h.score,
          status: h.note.fields?.status,
          tags: h.note.tags || [],
          modified_at: h.note.modified,
        }));
        return Promise.resolve({ results, total: hits.length, limit: l, offset: 0 });
      }

      const params = { limit: l };
      if (trimmed) params.query = trimmed;
      if (typeFilter) params.type = typeFilter;

      return window.AnvilClient.search(params).then((result) => {
        setCached(key, result);
        return result;
      });
    }, [query, typeFilter || null, l]);
  }

  window.HOOKS = { useNote, useEdges, useSearch, invalidate };
})();
