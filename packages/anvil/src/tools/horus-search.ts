// Handler for horus_search tool — unified cross-system search via Typesense

import type { HorusSearchInput } from '../types/tools.js';
import type { ToolContext } from './create-note.js';
import type { AnvilError } from '../types/error.js';
import { makeError, ERROR_CODES } from '../types/error.js';

const COLLECTION_NAME = 'horus_documents';

export interface HorusSearchResult {
  id: string;
  source: string;
  source_type: string;
  title: string;
  status?: string;
  priority?: string;
  tags: string[];
  score: number;
  snippet?: string;
}

export interface HorusSearchResponse {
  results: HorusSearchResult[];
  total: number;
  limit: number;
  offset: number;
}

function buildSnippet(
  highlights: Array<{ field: string; snippet?: string; snippets?: string[] }>,
): string {
  for (const h of highlights) {
    const raw = h.snippet ?? h.snippets?.[0];
    if (raw) return raw;
  }
  return '';
}

/**
 * Connected-mode control plane base URL (no trailing slash), or '' when local.
 * In connected mode the vault is served only by the control plane — local
 * Typesense holds anvil/forge docs but no vault docs — so vault-scoped search
 * must federate to the CP REST API rather than the empty local index.
 */
function controlPlaneBase(): string {
  return (process.env.HORUS_CONTROL_PLANE_URL || '').trim().replace(/\/$/, '');
}

/** Bearer token for CP calls. Mirrors horus-ui's static token provider. */
function controlPlaneToken(): string | null {
  const kind = (process.env.TOKEN_PROVIDER_KIND || 'none').trim().toLowerCase();
  if (kind === 'static') {
    return (process.env.TOKEN_PROVIDER_CONFIG || '').trim() || null;
  }
  return null;
}

/**
 * Search the vault via the control plane's authenticated REST endpoint and map
 * page summaries into horus_search's result shape. `vault` is omitted so the
 * control plane searches across all of the caller's assigned vaults.
 */
async function searchVaultViaControlPlane(
  cpBase: string,
  query: string,
  limit: number,
): Promise<HorusSearchResult[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = controlPlaneToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(`${cpBase}/api/v1/vault/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, limit }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }

  const data = (await resp.json()) as { results?: Array<Record<string, unknown>> };
  return (data.results ?? []).map((p) => ({
    id: String(p['id'] ?? ''),
    source: 'vault',
    source_type: String(p['type'] ?? ''),
    title: String(p['title'] ?? ''),
    tags: Array.isArray(p['tags']) ? (p['tags'] as string[]) : [],
    score: typeof p['relevance_score'] === 'number' ? (p['relevance_score'] as number) : 0,
    snippet: typeof p['description'] === 'string' ? (p['description'] as string) : '',
  }));
}

/**
 * Handle horus_search request.
 * Queries the shared horus_documents Typesense collection across all Horus systems.
 * Optionally scopes to a single source (anvil, vault, forge).
 */
export async function handleHorusSearch(
  input: HorusSearchInput,
  ctx: ToolContext
): Promise<HorusSearchResponse | AnvilError> {
  const limit = input.limit ?? 20;
  const offset = input.offset ?? 0;
  const page = Math.floor(offset / limit) + 1;

  // Connected mode: federate vault-scoped search to the control plane, whose
  // index holds the vault docs the local Typesense does not.
  const cpBase = controlPlaneBase();
  const federateVault = cpBase !== '' && (input.source === 'vault' || input.source == null);
  let vaultResults: HorusSearchResult[] = [];
  if (federateVault) {
    try {
      vaultResults = await searchVaultViaControlPlane(cpBase, input.query, limit);
    } catch (err) {
      // Vault-only request → surface the failure. Otherwise degrade to local.
      if (input.source === 'vault') {
        return makeError(
          ERROR_CODES.SERVER_ERROR,
          `vault search via control plane failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  // Vault-only search needs no local Typesense at all.
  if (input.source === 'vault') {
    return {
      results: vaultResults,
      total: vaultResults.length,
      limit,
      offset,
    };
  }

  if (!ctx.typesenseClient && ctx.tryReconnect) {
    await ctx.tryReconnect();
  }

  if (!ctx.typesenseClient) {
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      'Typesense not available — horus_search requires a running Typesense instance'
    );
  }

  try {
    const response = await ctx.typesenseClient
      .collections(COLLECTION_NAME)
      .documents()
      .search({
        q: input.query,
        query_by: 'title,body',
        ...(input.source ? { filter_by: `source:=${input.source}` } : {}),
        per_page: limit,
        page,
        highlight_full_fields: 'title',
        snippet_threshold: 30,
      });

    const hits = (response.hits ?? []) as Array<{
      document: Record<string, unknown>;
      text_match: number;
      highlights?: Array<{ field: string; snippet?: string; snippets?: string[] }>;
    }>;

    const results: HorusSearchResult[] = hits.map((hit) => {
      const doc = hit.document;
      return {
        id: String(doc['id'] ?? ''),
        source: String(doc['source'] ?? ''),
        source_type: String(doc['source_type'] ?? ''),
        title: String(doc['title'] ?? ''),
        status: doc['status'] != null ? String(doc['status']) : undefined,
        priority: doc['priority'] != null ? String(doc['priority']) : undefined,
        tags: Array.isArray(doc['tags']) ? (doc['tags'] as string[]) : [],
        score: hit.text_match,
        snippet: buildSnippet(hit.highlights ?? []),
      };
    });

    const localTotal = (response.found as number | undefined) ?? results.length;

    // No source filter in connected mode: local Typesense covers anvil/forge;
    // append the federated vault hits so cross-system search includes the vault.
    if (vaultResults.length > 0) {
      return {
        results: [...results, ...vaultResults],
        total: localTotal + vaultResults.length,
        limit,
        offset,
      };
    }

    return { results, total: localTotal, limit, offset };
  } catch (err) {
    return makeError(
      ERROR_CODES.SERVER_ERROR,
      `horus_search failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
