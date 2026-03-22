"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionList = sessionList;
const session_store_js_1 = require("./session-store.js");
// ─── Implementation ──────────────────────────────────────────────────────────
/**
 * List active sessions from the session store, with optional filtering.
 *
 * Returns sessions with host-side paths when Forge runs in Docker.
 * The `lastModified` field falls back to `createdAt` for sessions that
 * pre-date the lastModified field (backward-compatible).
 */
async function sessionList(opts, globalConfig) {
    const sessionsPath = globalConfig.workspace.sessions_path;
    const store = new session_store_js_1.SessionStoreManager(sessionsPath);
    const records = await store.listFiltered({
        repo: opts.repo,
        workItem: opts.workItem,
    });
    const sessions = records.map(r => ({
        sessionId: r.sessionId,
        sessionPath: r.hostSessionPath ?? r.sessionPath,
        repo: r.repo,
        workItem: r.workItem,
        branch: r.branch,
        createdAt: r.createdAt,
        lastModified: r.lastModified ?? r.createdAt,
    }));
    return { sessions };
}
//# sourceMappingURL=session-list.js.map