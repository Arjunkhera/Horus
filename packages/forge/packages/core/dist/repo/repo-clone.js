"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RepoCloneError = void 0;
exports.createReferenceClone = createReferenceClone;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
class RepoCloneError extends Error {
    suggestion;
    constructor(message, suggestion) {
        super(message);
        this.suggestion = suggestion;
        this.name = 'RepoCloneError';
        Object.setPrototypeOf(this, RepoCloneError.prototype);
    }
}
exports.RepoCloneError = RepoCloneError;
/**
 * Create an isolated reference clone of a repository.
 *
 * Uses `git clone --reference <localPath>` to reuse local objects for speed
 * while fetching from remoteUrl for freshness. Falls back to a plain local
 * clone when remoteUrl is null or unreachable (e.g. Docker without SSH).
 *
 * When branchName is provided, creates and checks out that branch.
 * When omitted, the clone stays on the default branch.
 *
 * Returns the actual default branch detected from the clone (which may differ
 * from opts.defaultBranch if the index entry is stale, e.g. 'master' vs 'main').
 */
async function createReferenceClone(opts) {
    const runGit = async (args, cwd) => {
        const { stdout } = await execFileAsync('git', args, { cwd, timeout: 60000 });
        return stdout.trim();
    };
    // Detect the real default branch from the cloned repo's HEAD.
    // Falls back to known candidates if HEAD is detached, then to opts.defaultBranch.
    const detectActualBranch = async () => {
        try {
            const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], opts.destPath);
            if (branch && branch !== 'HEAD')
                return branch;
        }
        catch {
            // ignore
        }
        for (const candidate of ['main', 'master']) {
            try {
                await runGit(['rev-parse', '--verify', candidate], opts.destPath);
                return candidate;
            }
            catch {
                // not found
            }
        }
        return opts.defaultBranch;
    };
    const checkoutBranch = async (base) => {
        if (!opts.branchName)
            return;
        try {
            await runGit(['checkout', '-b', opts.branchName, base], opts.destPath);
        }
        catch (err) {
            if ((err.message || '').includes('already exists')) {
                await runGit(['checkout', opts.branchName], opts.destPath);
            }
            else {
                // Clean up the partial clone before re-throwing so no stale directory remains.
                await fs_1.promises.rm(opts.destPath, { recursive: true, force: true }).catch(() => { });
                throw err;
            }
        }
    };
    const cloneLocalOnly = async () => {
        await runGit(['clone', opts.localPath, opts.destPath], path_1.default.dirname(opts.destPath));
    };
    if (!opts.remoteUrl) {
        try {
            await cloneLocalOnly();
            const actualDefaultBranch = await detectActualBranch();
            await checkoutBranch(actualDefaultBranch);
            return { actualDefaultBranch };
        }
        catch (err) {
            if (err instanceof RepoCloneError)
                throw err;
            throw new RepoCloneError(`Failed to clone ${opts.localPath} to ${opts.destPath}: ${err.message}`, 'Check that the local repo path is valid');
        }
    }
    // Try reference clone from remote first
    try {
        await runGit(['clone', '--reference', opts.localPath, opts.remoteUrl, opts.destPath], path_1.default.dirname(opts.destPath));
        const actualDefaultBranch = await detectActualBranch();
        await checkoutBranch(`origin/${actualDefaultBranch}`);
        return { actualDefaultBranch };
    }
    catch {
        // Remote clone (or checkout) failed — fall back to local-only
    }
    // Local-only fallback (e.g. Docker without SSH/network access)
    try {
        await fs_1.promises.rm(opts.destPath, { recursive: true, force: true }).catch(() => { });
        await cloneLocalOnly();
        const actualDefaultBranch = await detectActualBranch();
        await checkoutBranch(actualDefaultBranch);
        // Fix origin: local-only fallback sets origin to localPath (Docker-internal).
        // Repoint to remoteUrl so git push works from the host.
        await runGit(['remote', 'set-url', 'origin', opts.remoteUrl], opts.destPath);
        return { actualDefaultBranch };
    }
    catch (err) {
        if (err instanceof RepoCloneError)
            throw err;
        throw new RepoCloneError(`Failed to clone ${opts.localPath} to ${opts.destPath}: ${err.message}`, 'Check that the local repo path is valid');
    }
}
//# sourceMappingURL=repo-clone.js.map