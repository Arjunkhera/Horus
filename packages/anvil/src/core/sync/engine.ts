import { simpleGit, type SimpleGit } from 'simple-git';
import { GitMutex } from './mutex.js';
import { type SyncHealthState, createInitialHealthState } from './health.js';
import type { AnvilWatcher } from '../../storage/watcher.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

export interface GitSyncEngineOptions {
  notesPath: string;
  watcher: AnvilWatcher;
  pushDebounceMs?: number;
  pullIntervalMs?: number;
  gitTimeoutMs?: number;
  maxRetries?: number;
  onReindex?: () => Promise<void>;
}

type ResolvedOptions = Required<GitSyncEngineOptions>;

const DEFAULTS = {
  pushDebounceMs: 5_000,
  pullIntervalMs: 60_000,
  gitTimeoutMs: 60_000,
  maxRetries: 3,
  onReindex: async () => {},
} as const;

const STALE_LOCK_AGE_MS = 5 * 60 * 1000;
const MIN_RETRY_MS = 10_000;
const MAX_RETRY_MS = 120_000;
const POST_PUSH_PULL_DELAY_MS = 1_000;

export class GitSyncEngine {
  private mutex = new GitMutex();
  private health: SyncHealthState;
  private pullInterval: NodeJS.Timeout | null = null;
  private pushDebounceTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private running = false;
  private opts: ResolvedOptions;

  constructor(opts: GitSyncEngineOptions) {
    this.opts = {
      ...DEFAULTS,
      ...opts,
    } as ResolvedOptions;
    this.health = createInitialHealthState();
  }

  // ── Lifecycle ──

  async start(): Promise<void> {
    this.running = true;
    this.health.daemonAlive = true;

    await this.cleanStaleLocks();
    await this.push();
    await this.pull();

    this.pullInterval = setInterval(() => this.pull(), this.opts.pullIntervalMs);
    this.subscribeToWatcher();

    this.log('info', 'GitSyncEngine started', {
      pushDebounceMs: this.opts.pushDebounceMs,
      pullIntervalMs: this.opts.pullIntervalMs,
      gitTimeoutMs: this.opts.gitTimeoutMs,
    });
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.pullInterval) clearInterval(this.pullInterval);
    if (this.pushDebounceTimer) clearTimeout(this.pushDebounceTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.pullInterval = null;
    this.pushDebounceTimer = null;
    this.retryTimer = null;

    this.log('info', 'GitSyncEngine stopping — running final push...');
    await this.push();

    this.health.daemonAlive = false;
    this.log('info', 'GitSyncEngine stopped');
  }

  getHealth(): Readonly<SyncHealthState> {
    return { ...this.health };
  }

  schedulePush(): void {
    if (!this.running) return;
    if (this.pushDebounceTimer) clearTimeout(this.pushDebounceTimer);
    this.pushDebounceTimer = setTimeout(() => this.push(), this.opts.pushDebounceMs);
  }

  // ── Push ──

  async push(): Promise<{ status: string; commitHash?: string; filesCommitted?: number; error?: string }> {
    const release = await this.mutex.acquire('high');
    try {
      await this.cleanStaleLocks();
      const git = this.createGit();

      await this.stageFiles(git);

      // Check staged files via git.status() — simple-git's diff() does not
      // reject on exit code 1 with --quiet, so git diff --cached --quiet
      // always resolves and hasStagedChanges would always be false.
      const statusBeforeCommit = await git.status();
      const filesCommitted = statusBeforeCommit.staged?.length ?? 0;

      if (filesCommitted === 0) {
        return { status: 'no_changes' };
      }

      const timestamp = new Date().toISOString();
      let commitHash = '';
      try {
        const commitResult = await git.commit(`auto: sync ${timestamp}`);
        commitHash = commitResult.commit;
        // If git.commit() returned silently with no hash, nothing was committed
        if (!commitHash) {
          return { status: 'no_changes' };
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.message?.includes('nothing to commit')) {
          return { status: 'no_changes' };
        }
        throw err;
      }

      this.health.lastPushAttempt = new Date().toISOString();

      try {
        await git.push();

        this.health.lastPushSuccess = new Date().toISOString();
        this.health.lastPushError = null;
        this.health.pushConsecutiveFailures = 0;
        await this.updateAheadBehind(git);
        this.log('info', 'Push complete');

        if (this.running) {
          setTimeout(() => this.pull(), POST_PUSH_PULL_DELAY_MS);
        }
        return { status: 'ok', commitHash, filesCommitted };
      } catch (pushErr: unknown) {
        const errMsg =
          pushErr instanceof Error ? pushErr.message : String(pushErr);

        if (
          errMsg.includes('non-fast-forward') ||
          errMsg.includes('rejected') ||
          errMsg.includes('fetch first')
        ) {
          return await this.resolveAndRetryPush(git);
        }

        this.health.pushConsecutiveFailures++;
        this.health.lastPushError = errMsg;
        this.log('error', 'Push failed', {
          error: errMsg,
          failures: this.health.pushConsecutiveFailures,
        });
        this.scheduleRetryPush();
        return { status: 'push_failed', error: errMsg };
      }
    } finally {
      release();
    }
  }

  // ── Pull ──

  async pull(): Promise<{
    status: string;
    filesChanged?: number;
    error?: string;
  }> {
    const release = await this.mutex.acquire('low');
    try {
      await this.cleanStaleLocks();
      const git = this.createGit();

      this.health.lastPullAttempt = new Date().toISOString();

      try {
        await git.fetch('origin');
        await this.updateAheadBehind(git);

        if (this.health.behindBy === 0) {
          this.health.lastPullSuccess = new Date().toISOString();
          this.health.lastPullError = null;
          this.health.pullConsecutiveFailures = 0;
          return { status: 'no_changes' };
        }

        const trackingRef = await this.getTrackingRef(git);

        try {
          await git.merge(['--ff-only', trackingRef]);
        } catch {
          try {
            await git.rebase([trackingRef]);
          } catch (rebaseErr: unknown) {
            return await this.handleConflict(git, rebaseErr);
          }
        }

        if (this.opts.onReindex) {
          await this.opts.onReindex();
        }

        await this.updateAheadBehind(git);
        this.health.lastPullSuccess = new Date().toISOString();
        this.health.lastPullError = null;
        this.health.pullConsecutiveFailures = 0;
        this.log('info', 'Pull complete', { behindBy: this.health.behindBy });

        return { status: 'ok', filesChanged: this.health.behindBy };
      } catch (err: unknown) {
        const errMsg =
          err instanceof Error ? err.message : String(err);
        this.health.pullConsecutiveFailures++;
        this.health.lastPullError = errMsg;
        this.log('error', 'Pull failed', {
          error: errMsg,
          failures: this.health.pullConsecutiveFailures,
        });
        return { status: 'pull_failed', error: errMsg };
      }
    } finally {
      release();
    }
  }

  // ── Private helpers ──

  private createGit(): SimpleGit {
    return simpleGit(this.opts.notesPath, {
      timeout: { block: this.opts.gitTimeoutMs },
    });
  }

  /**
   * Stage .md files and .anvil/types/*.yaml — mirrors the staging rules
   * from syncPush so both code paths stay consistent.
   */
  private async stageFiles(git: SimpleGit): Promise<void> {
    try {
      await git.add(['*.md']);
    } catch {
      /* no .md files to stage */
    }
    try {
      const typesDir = path.join(this.opts.notesPath, '.anvil', 'types');
      await fs.stat(typesDir);
      await git.add(['.anvil/types/*.yaml']);
    } catch {
      /* types dir doesn't exist or no yaml files */
    }
  }

  /**
   * Resolve the remote tracking ref for the current branch.
   * Falls back to origin/<branch> then origin/HEAD.
   */
  private async getTrackingRef(git: SimpleGit): Promise<string> {
    try {
      const status = await git.status();
      if (status.tracking) return status.tracking;
      if (status.current) return `origin/${status.current}`;
    } catch {
      /* fallback */
    }
    return 'origin/HEAD';
  }

  /**
   * Push was rejected (non-fast-forward). Fetch, rebase on remote, then
   * retry the push. Falls through to conflict quarantine if rebase fails.
   */
  private async resolveAndRetryPush(
    git: SimpleGit,
  ): Promise<{ status: string; error?: string }> {
    this.log(
      'warn',
      'Push rejected (non-fast-forward) — attempting fetch + rebase then retry',
    );

    try {
      await git.fetch('origin');
      const trackingRef = await this.getTrackingRef(git);
      await git.rebase([trackingRef]);
    } catch (rebaseErr: unknown) {
      return await this.handleConflict(git, rebaseErr);
    }

    try {
      await git.push();
      this.health.lastPushSuccess = new Date().toISOString();
      this.health.lastPushError = null;
      this.health.pushConsecutiveFailures = 0;
      await this.updateAheadBehind(git);
      this.log('info', 'Push complete after rebase');
      return { status: 'ok' };
    } catch (retryErr: unknown) {
      const errMsg =
        retryErr instanceof Error ? retryErr.message : String(retryErr);
      this.health.pushConsecutiveFailures++;
      this.health.lastPushError = errMsg;
      this.log('error', 'Push failed after rebase', { error: errMsg });
      this.scheduleRetryPush();
      return { status: 'push_failed', error: errMsg };
    }
  }

  /**
   * Rebase produced conflicts. Abort the rebase, quarantine local divergent
   * commits on a timestamped branch, and hard-reset the working branch to
   * the remote HEAD so writes can resume immediately.
   */
  private async handleConflict(
    git: SimpleGit,
    rebaseErr: unknown,
  ): Promise<{ status: string; error?: string }> {
    const errMsg =
      rebaseErr instanceof Error ? rebaseErr.message : String(rebaseErr);
    this.log(
      'error',
      'CRITICAL: Rebase conflict detected — quarantining local changes',
      { error: errMsg },
    );

    try {
      await git.rebase(['--abort']);
    } catch {
      /* may already be aborted */
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const conflictBranch = `conflict/${ts}`;

    try {
      await git.branch([conflictBranch]);
    } catch (branchErr: unknown) {
      this.log('error', 'Failed to create quarantine branch', {
        error:
          branchErr instanceof Error ? branchErr.message : String(branchErr),
      });
    }

    const trackingRef = await this.getTrackingRef(git);
    await git.reset(['--hard', trackingRef]);

    this.health.conflictBranch = conflictBranch;
    this.health.lastConflict = new Date().toISOString();
    this.health.pushConsecutiveFailures++;
    this.health.lastPushError = `Conflict quarantined to branch: ${conflictBranch}`;

    if (this.opts.onReindex) {
      await this.opts.onReindex();
    }

    this.log(
      'error',
      `Conflict quarantined to branch "${conflictBranch}". Run "git diff main..${conflictBranch}" to see diverged changes.`,
    );

    return {
      status: 'conflict',
      error: `Conflict quarantined to branch: ${conflictBranch}`,
    };
  }

  private async cleanStaleLocks(): Promise<void> {
    const lockPath = path.join(this.opts.notesPath, '.git', 'index.lock');
    try {
      const stat = await fs.stat(lockPath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs > STALE_LOCK_AGE_MS) {
        await fs.unlink(lockPath);
        this.log('warn', `Removed stale git lock file (age: ${Math.round(ageMs / 1000)}s)`);
      }
    } catch {
      /* no lock file — normal */
    }
  }

  private async updateAheadBehind(git: SimpleGit): Promise<void> {
    try {
      const status = await git.status();
      this.health.aheadBy = status.ahead;
      this.health.behindBy = status.behind;
      this.health.pendingFiles = status.files.length;
    } catch {
      /* non-fatal — health data is best-effort */
    }
  }

  private scheduleRetryPush(): void {
    if (!this.running) return;
    const backoffMs = Math.min(
      MIN_RETRY_MS * Math.pow(2, this.health.pushConsecutiveFailures - 1),
      MAX_RETRY_MS,
    );
    this.log('info', `Scheduling push retry in ${backoffMs}ms`);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.push(), backoffMs);
  }

  /**
   * Hook into the watcher's batch-complete event so every local
   * write (processed by AnvilWatcher) triggers a debounced push.
   */
  private subscribeToWatcher(): void {
    this.opts.watcher.addBatchCompleteListener(() => this.schedulePush());
  }

  private log(
    level: string,
    message: string,
    extra?: Record<string, unknown>,
  ): void {
    process.stderr.write(
      JSON.stringify({
        level,
        message: `[sync-engine] ${message}`,
        timestamp: new Date().toISOString(),
        ...extra,
      }) + '\n',
    );
  }
}
