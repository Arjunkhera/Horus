// Vault REST client for the Reader SPA.
// Exposes window.VaultClient — a thin fetch wrapper over the vault proxy routes
// served by horus-ui's Express server at /vault/*.
// The proxy injects bearer-token auth server-side; no auth handling needed here.
// All methods throw on network/API errors; callers should catch and degrade gracefully.
(function () {
  async function apiFetch(path, body) {
    var res;
    try {
      res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
    } catch (err) {
      var e = new Error('Vault network error: ' + err.message);
      e.code = 'NETWORK_ERROR';
      throw e;
    }
    // 503 = local-only mode (vault not configured)
    if (res.status === 503) {
      var e503 = new Error('Vault is not available in local-only mode.');
      e503.code = 'VAULT_NOT_CONFIGURED';
      e503.status = 503;
      throw e503;
    }
    if (!res.ok) {
      var detail = '';
      try { var d = await res.json(); detail = d.detail || d.error || ''; } catch (x) {}
      var eHttp = new Error('Vault error ' + res.status + (detail ? ': ' + detail : ''));
      eHttp.status = res.status;
      throw eHttp;
    }
    return res.json();
  }

  window.VaultClient = {
    /**
     * Check vault reachability. Returns true/false — never throws.
     * Returns false in local-only mode (503) or when control plane is unreachable.
     */
    async ping() {
      try {
        var r = await fetch('/vault/health', { signal: AbortSignal.timeout(3000) });
        return r.ok;
      } catch (err) {
        return false;
      }
    },

    /**
     * List all vaults available on the control plane.
     * Returns { vaults: [{namespace, default, page_count}], default_vault, total }
     */
    listVaults() {
      return apiFetch('/vault/vaults', {});
    },

    /**
     * List all pages in a vault.
     * @param {{ vault: string, limit?: number }} params
     * Returns { pages: PageSummary[], total }
     * PageSummary: { id, title, description, type, mode, scope, tags }
     */
    listPages(params) {
      return apiFetch('/vault/list-by-scope', {
        scope: {},
        vault: params.vault,
        limit: params.limit || 100,
      });
    },

    /**
     * Fetch a full page by UUID.
     * @param {string} id
     * @param {string} [vault] owning vault hint — lets the router skip UUID
     *   resolution and go straight to the owning vault. When omitted, the
     *   router resolves the owning vault (falling back to a cross-vault fan-out).
     * Returns PageFull: PageSummary + { body } (markdown)
     */
    getPage(id, vault) {
      return apiFetch('/vault/get-page', vault ? { id: id, vault: vault } : { id: id });
    },

    /**
     * Search vault pages via hybrid search (keyword + semantic).
     * @param {{ query: string, vault?: string, limit?: number, type?: string, mode?: string }} params
     * Returns { results: [{ id, title, type, mode, description, tags, score, snippet }] }
     */
    search(params) {
      return apiFetch('/vault/search', {
        query: params.query,
        vault: params.vault,
        limit: params.limit || 12,
        type: params.type,
        mode: params.mode,
      });
    },
  };
})();
