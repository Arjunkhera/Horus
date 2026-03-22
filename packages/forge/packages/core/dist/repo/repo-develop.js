"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.repoDevelop = repoDevelop;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const node_crypto_1 = require("node:crypto");
const session_store_js_1 = require("../session/session-store.js");
const errors_js_1 = require("../adapters/errors.js");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
// ─── Internal helpers ────────────────────────────────────────────────────────
async function runGit(args, cwd, timeout = 30000) {
    const { stdout } = await execFileAsync('git', args, { cwd, timeout });
    return stdout.trim();
}
/** Generate a short random ID for sessions, e.g. "sess-ab12cd34" */
function generateSessionId() {
    return 'sess-' + (0, node_crypto_1.randomBytes)(4).toString('hex');
}
/**
 * Convert a workItem ID/slug to a filesystem-safe slug.
 * e.g. "2d9c5c7d-3f56-4a61-a197-2530dcc4db0e" → "2d9c5c7d"
 * e.g. "forge-develop-tool" → "forge-develop-tool"
 */
function toSlug(workItem) {
    // If it looks like a UUID, use the first segment
    const uuidMatch = workItem.match(/^([0-9a-f]{8})-/i);
    if (uuidMatch)
        return uuidMatch[1];
    // Otherwise sanitize
    return workItem.replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 40);
}
/**
 * Auto-detect workflow from git remotes.
 * - Has 'upstream' remote → fork workflow
 * - Otherwise → owner (direct push)
 */
async function detectWorkflow(localPath, repoEntry) {
    let remotes = [];
    try {
        const out = await runGit(['remote', '-v'], localPath, 5000);
        remotes = out.split('\n').map(l => l.trim()).filter(Boolean);
    }
    catch {
        // Not a git repo or git not available — fall through to defaults
    }
    const hasUpstream = remotes.some(r => r.startsWith('upstream\t') || r.startsWith('upstream '));
    const defaultBranch = repoEntry.defaultBranch;
    // Derive org/repo from remoteUrl, e.g. git@github.com:Org/Repo.git → Org/Repo
    let prTargetRepo = repoEntry.name;
    if (repoEntry.remoteUrl) {
        const m = repoEntry.remoteUrl.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
        if (m)
            prTargetRepo = m[1];
    }
    if (hasUpstream) {
        const upstreamLine = remotes.find(r => r.startsWith('upstream\t') || r.startsWith('upstream '));
        const upstreamUrl = upstreamLine?.split(/\s+/)[1] ?? repoEntry.remoteUrl ?? '';
        return {
            type: 'fork',
            upstream: upstreamUrl,
            fork: repoEntry.remoteUrl ?? undefined,
            pushTo: 'origin',
            prTarget: { repo: prTargetRepo, branch: defaultBranch },
        };
    }
    return {
        type: 'owner',
        pushTo: 'origin',
        prTarget: { repo: prTargetRepo, branch: defaultBranch },
    };
}
/**
 * Clone a repo into the managed pool as a regular clone (not bare).
 * Used for tier-3 resolution when the repo isn't indexed locally.
 */
async function cloneToManagedPool(remoteUrl, destPath) {
    await fs_1.promises.mkdir(path_1.default.dirname(destPath), { recursive: true });
    try {
        await execFileAsync('git', ['clone', remoteUrl, destPath], {
            timeout: 120000,
        });
    }
    catch (err) {
        throw new errors_js_1.ForgeError('CLONE_FAILED', `Failed to clone ${remoteUrl} to ${destPath}: ${err.message}`, 'Check the remote URL and your network/SSH access.');
    }
}
/**
 * Fetch all remotes in a repo. Degrades gracefully if network is unavailable.
 * Returns true if fetch succeeded, false if it failed (with warning logged).
 */
async function fetchRemotes(repoPath) {
    try {
        await execFileAsync('git', ['fetch', '--all', '--prune'], {
            cwd: repoPath,
            timeout: 30000,
        });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Install placeholder git hooks and enforcement scripts in the worktree.
 * Full implementation is deferred to WI-4.
 */
async function installPlaceholderHooks(worktreePath) {
    const hooksDir = path_1.default.join(worktreePath, '.git', 'hooks');
    await fs_1.promises.mkdir(hooksDir, { recursive: true });
    // pre-push hook placeholder
    const prePush = `#!/bin/sh
# forge_develop pre-push hook (placeholder — full implementation in WI-4)
exit 0
`;
    // commit-msg hook placeholder
    const commitMsg = `#!/bin/sh
# forge_develop commit-msg hook (placeholder — full implementation in WI-4)
exit 0
`;
    await fs_1.promises.writeFile(path_1.default.join(hooksDir, 'pre-push'), prePush, { mode: 0o755 });
    await fs_1.promises.writeFile(path_1.default.join(hooksDir, 'commit-msg'), commitMsg, { mode: 0o755 });
}
// ─── Main function ────────────────────────────────────────────────────────────
/**
 * Core logic for `forge_develop`:
 *
 * 1. Resolve the repo via 3-tier lookup
 * 2. Check for existing session → resume if found
 * 3. Verify workflow is confirmed (or accept inline workflow input)
 * 4. git fetch + worktree creation
 * 5. Install placeholder hooks
 * 6. Save session record
 */
async function repoDevelop(opts, globalConfig, repoIndex, saveRepoIndexFn) {
    const { repo: repoName, workItem, branch: requestedBranch, workflow: inlineWorkflow } = opts;
    const sessionsPath = globalConfig.workspace.sessions_path;
    const managedReposPath = globalConfig.workspace.managed_repos_path;
    const sessionsRoot = globalConfig.workspace.sessions_root;
    const hostWorkspacesPath = globalConfig.workspace.host_workspaces_path;
    const sessionStore = new session_store_js_1.SessionStoreManager(sessionsPath);
    // ── Tier-1: Check user repo index ─────────────────────────────────────────
    let repoEntry = null;
    let repoSource = 'user';
    if (repoIndex) {
        repoEntry = repoIndex.repos.find(r => r.name.toLowerCase() === repoName.toLowerCase()) ?? null;
    }
    // ── Tier-2: Check managed pool ────────────────────────────────────────────
    if (!repoEntry) {
        const managedPath = path_1.default.join(managedReposPath, repoName);
        try {
            await fs_1.promises.access(managedPath);
            // Found in managed pool — build a synthetic entry
            repoEntry = {
                name: repoName,
                localPath: managedPath,
                remoteUrl: null,
                defaultBranch: 'main',
                language: null,
                framework: null,
                lastCommitDate: new Date().toISOString(),
                lastScannedAt: new Date().toISOString(),
            };
            repoSource = 'managed';
            // Try to get default branch from the repo
            try {
                const branch = await runGit(['symbolic-ref', '--short', 'HEAD'], managedPath, 5000);
                if (branch)
                    repoEntry.defaultBranch = branch;
            }
            catch { /* ignore */ }
            // Try to get remote URL
            try {
                const remoteUrl = await runGit(['remote', 'get-url', 'origin'], managedPath, 5000);
                if (remoteUrl)
                    repoEntry = { ...repoEntry, remoteUrl };
            }
            catch { /* ignore */ }
        }
        catch {
            // Not in managed pool either
        }
    }
    // ── Tier-3: Clone from remote ─────────────────────────────────────────────
    if (!repoEntry) {
        // We have no local copy at all. We cannot proceed without a remote URL —
        // there's nothing to clone from. Return a clear error.
        throw new errors_js_1.ForgeError('REPO_NOT_FOUND', `Repository "${repoName}" was not found in the local index or managed pool.`, `To proceed:\n` +
            `  1. If the repo exists locally: run 'forge repo scan' to add it to the index.\n` +
            `  2. If you want to clone from a remote: call forge_develop with a remoteUrl parameter (not yet supported — coming in a future release).\n` +
            `  3. Or check the repo name spelling.`);
    }
    // ── Check for existing session (resume flow) ──────────────────────────────
    const existing = await sessionStore.findByWorkItem(workItem, repoName);
    if (existing) {
        // Verify the session directory still exists
        try {
            await fs_1.promises.access(existing.sessionPath);
            // Update lastModified on resume
            await sessionStore.touch(existing.sessionId);
            return {
                status: 'resumed',
                sessionId: existing.sessionId,
                sessionPath: existing.sessionPath,
                hostSessionPath: existing.hostSessionPath,
                branch: existing.branch,
                baseBranch: existing.baseBranch,
                repo: existing.repo,
                repoSource: existing.repoSource,
                workflow: existing.workflow,
                agentSlot: existing.agentSlot,
            };
        }
        catch {
            // Session path gone (manually deleted?) — treat as new session
        }
    }
    // ── Workflow confirmation check ───────────────────────────────────────────
    let confirmedWorkflow = repoEntry.workflow ?? null;
    if (!confirmedWorkflow && !inlineWorkflow) {
        // Auto-detect and ask for confirmation
        const detected = await detectWorkflow(repoEntry.localPath, repoEntry);
        return {
            status: 'needs_workflow_confirmation',
            detected,
            message: `Repository "${repoName}" has no confirmed workflow. ` +
                `Call forge_develop again with the 'workflow' parameter to confirm and proceed. ` +
                `The detected values above are a starting point — adjust if needed.`,
        };
    }
    // If inline workflow provided, save it to repo index for future calls
    if (inlineWorkflow && !confirmedWorkflow) {
        const now = new Date().toISOString();
        const newWorkflow = {
            type: inlineWorkflow.type,
            upstream: inlineWorkflow.upstream,
            fork: inlineWorkflow.fork,
            pushTo: inlineWorkflow.pushTo,
            prTarget: inlineWorkflow.prTarget,
            branchPattern: inlineWorkflow.branchPattern,
            commitFormat: inlineWorkflow.commitFormat,
            confirmedAt: now,
            confirmedBy: 'user',
        };
        const updatedEntry = { ...repoEntry, workflow: newWorkflow };
        const updatedRepos = repoIndex
            ? repoIndex.repos.map(r => r.name === repoName ? updatedEntry : r)
            : [updatedEntry];
        await saveRepoIndexFn(updatedRepos);
        repoEntry = updatedEntry;
        confirmedWorkflow = newWorkflow;
    }
    // If inline workflow provided but repo already had a saved workflow, use inline (override for this call)
    const effectiveWorkflow = inlineWorkflow ?? confirmedWorkflow;
    // ── Determine base branch ─────────────────────────────────────────────────
    const baseBranch = effectiveWorkflow.prTarget.branch ?? repoEntry.defaultBranch;
    // ── Determine feature branch name ─────────────────────────────────────────
    const slug = toSlug(workItem);
    const featureBranch = requestedBranch ?? `feature/${slug}`;
    // ── Max sessions ceiling check (warn only, never block) ──────────────────
    const maxSessions = globalConfig.workspace.max_sessions ?? 20;
    const totalSessions = await sessionStore.count();
    let sessionCeilingWarning;
    if (totalSessions >= maxSessions) {
        sessionCeilingWarning =
            `Session ceiling reached: ${totalSessions}/${maxSessions} active sessions. ` +
                `Consider running forge_session_cleanup to reclaim stale sessions.`;
    }
    // ── Compute session path ──────────────────────────────────────────────────
    const sessionCount = await sessionStore.countByWorkItem(workItem, repoName);
    const agentSlot = sessionCount + 1;
    const suffix = agentSlot > 1 ? `-${agentSlot}` : '';
    const sessionDirName = `${slug}-${repoName.toLowerCase()}${suffix}`;
    const sessionPath = path_1.default.join(sessionsRoot, sessionDirName);
    // ── Git fetch (best-effort) ───────────────────────────────────────────────
    await fetchRemotes(repoEntry.localPath);
    // ── Create git worktree ───────────────────────────────────────────────────
    await fs_1.promises.mkdir(sessionsRoot, { recursive: true });
    // Check if the session path already exists (partial state from a prior failed attempt)
    try {
        await fs_1.promises.access(sessionPath);
        // Path exists but no session record — clean it up
        await fs_1.promises.rm(sessionPath, { recursive: true, force: true });
    }
    catch {
        // Doesn't exist — good
    }
    // Determine the tracking ref for the worktree base
    // Prefer origin/<baseBranch> if available, else local baseBranch
    let worktreeBase = baseBranch;
    try {
        await runGit(['rev-parse', '--verify', `origin/${baseBranch}`], repoEntry.localPath, 5000);
        worktreeBase = `origin/${baseBranch}`;
    }
    catch {
        // No origin/<baseBranch> — use local branch
    }
    try {
        await execFileAsync('git', ['worktree', 'add', sessionPath, '-b', featureBranch, worktreeBase], { cwd: repoEntry.localPath, timeout: 30000 });
    }
    catch (err) {
        // If branch already exists, try to check it out instead
        if ((err.message ?? '').includes('already exists')) {
            try {
                await execFileAsync('git', ['worktree', 'add', sessionPath, featureBranch], { cwd: repoEntry.localPath, timeout: 30000 });
            }
            catch (err2) {
                await fs_1.promises.rm(sessionPath, { recursive: true, force: true }).catch(() => { });
                throw new errors_js_1.ForgeError('WORKTREE_CREATE_FAILED', `Failed to create git worktree at ${sessionPath}: ${err2.message}`, `Check that the branch '${featureBranch}' is not checked out in another worktree.`);
            }
        }
        else {
            await fs_1.promises.rm(sessionPath, { recursive: true, force: true }).catch(() => { });
            throw new errors_js_1.ForgeError('WORKTREE_CREATE_FAILED', `Failed to create git worktree at ${sessionPath}: ${err.message}`, `Ensure git is available and the base branch '${baseBranch}' exists.`);
        }
    }
    // ── Install placeholder hooks ─────────────────────────────────────────────
    await installPlaceholderHooks(sessionPath);
    // ── Compute host-side path (Docker path translation) ──────────────────────
    let hostSessionPath;
    if (hostWorkspacesPath && sessionsRoot.includes('/data/')) {
        // Translate /data/sessions/... → hostWorkspacesPath/../sessions/...
        const dataIdx = sessionsRoot.indexOf('/data/');
        if (dataIdx !== -1) {
            const rel = sessionsRoot.slice(dataIdx + '/data/'.length);
            const hostDataBase = hostWorkspacesPath.replace(/\/workspaces\/?$/, '');
            const hostSessionsRoot = path_1.default.join(hostDataBase, rel);
            const sessionRelative = path_1.default.relative(sessionsRoot, sessionPath);
            hostSessionPath = path_1.default.join(hostSessionsRoot, sessionRelative);
        }
    }
    // ── Build workflow snapshot ───────────────────────────────────────────────
    const sessionWorkflow = {
        type: effectiveWorkflow.type,
        pushTo: effectiveWorkflow.pushTo,
        prTarget: effectiveWorkflow.prTarget,
    };
    // ── Save session record ───────────────────────────────────────────────────
    const sessionId = generateSessionId();
    const now = new Date().toISOString();
    const record = {
        sessionId,
        workItem,
        repo: repoName,
        branch: featureBranch,
        baseBranch,
        sessionPath,
        hostSessionPath,
        repoSource,
        workflow: sessionWorkflow,
        agentSlot,
        createdAt: now,
        lastModified: now,
    };
    await sessionStore.add(record);
    return {
        status: 'created',
        sessionId,
        sessionPath,
        hostSessionPath,
        branch: featureBranch,
        baseBranch,
        repo: repoName,
        repoSource,
        workflow: sessionWorkflow,
        agentSlot,
        ...(sessionCeilingWarning ? { warning: sessionCeilingWarning } : {}),
    };
}
//# sourceMappingURL=repo-develop.js.map