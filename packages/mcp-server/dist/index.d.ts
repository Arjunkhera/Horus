/**
 * Start the Forge MCP server on stdio transport.
 * Used for local Claude Code integration.
 */
export declare function startMcpServer(workspaceRoot?: string): Promise<void>;
export interface HttpServerOptions {
    port: number;
    host: string;
    workspaceRoot?: string;
}
/**
 * Start the Forge MCP server on HTTP (StreamableHTTP) transport.
 * Features:
 *   - /health endpoint returning service status and uptime
 *   - Graceful shutdown on SIGTERM/SIGINT
 *   - JSON logging to stderr
 *
 * Used in Docker via `forge serve --transport http`.
 */
export declare function startMcpServerHttp(opts: HttpServerOptions): Promise<void>;
//# sourceMappingURL=index.d.ts.map