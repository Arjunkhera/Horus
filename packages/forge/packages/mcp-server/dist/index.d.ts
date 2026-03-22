/**
 * Validate forge_repo_clone arguments.
 *
 * Returns an error object if the call is invalid, null if valid.
 * Exported so tests can assert on the guard directly without invoking the full
 * MCP transport — this ensures a future refactor cannot accidentally drop the
 * validation without breaking the test suite.
 *
 * The recurring regression: callers omit workspacePath, causing clones to land
 * at the global mount root (/workspaces/<repo>) instead of the workspace
 * folder (/workspaces/<workspace-id>/<repo>). Without this guard the failure
 * is silent — the clone succeeds at the wrong path.
 */
export declare function validateRepoCloneArgs(args: {
    repoName?: string;
    workspacePath?: string;
    destPath?: string;
}): {
    error: true;
    code: string;
    message: string;
    suggestion: string;
} | null;
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