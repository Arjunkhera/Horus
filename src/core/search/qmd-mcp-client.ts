// REST client for communicating with the shared QMD HTTP daemon.
// Uses the /query endpoint (QMD v1.1.0+) — no MCP session management needed.

export interface QMDSearchResult {
  docid: string;
  file: string;
  title: string;
  score: number;
  context?: string;
  snippet: string;
}

/** Maps MCP tool names to QMD REST search types. */
const TOOL_TO_SEARCH_TYPE: Record<string, string[]> = {
  search: ['lex'],
  vector_search: ['vec'],
  deep_search: ['lex', 'vec'],
};

/** Timeout for QMD REST calls. Vec search is slow on CPU; callers fall back to FTS on timeout. */
const QMD_TIMEOUT_MS = 8_000;

export class QMDMcpClient {
  private readonly queryUrl: string;

  constructor(daemonUrl: string) {
    this.queryUrl = daemonUrl.replace(/\/$/, '') + '/query';
  }

  /**
   * Call a QMD search operation via the REST /query endpoint.
   * Accepts the same tool names as the old MCP interface for compatibility:
   *   search → lex, vector_search → vec, deep_search → lex + vec
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<QMDSearchResult[]> {
    const searchTypes = TOOL_TO_SEARCH_TYPE[name];
    if (!searchTypes) {
      throw new Error(`Unknown QMD tool: ${name}`);
    }

    const query = String(args['query'] ?? '');
    const searches = searchTypes.map((type) => ({ type, query }));

    const body: Record<string, unknown> = {
      searches,
      limit: args['limit'] ?? 10,
    };

    if (args['collection']) {
      body['collections'] = [args['collection']];
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), QMD_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(this.queryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new Error(`QMD REST query failed: HTTP ${res.status}`);
    }

    const json = (await res.json()) as Record<string, unknown>;
    return (json['results'] as QMDSearchResult[]) ?? [];
  }
}
