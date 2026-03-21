// Sync daemon — runs as background async tasks inside the MCP server process
// Handles: git pull loop + filesystem watcher → QMD re-index

import chokidar from 'chokidar';
import type { SimpleGit } from 'simple-git';
import { simpleGit } from 'simple-git';

export interface SyncDaemonOptions {
  notesPath: string;
  gitPullInterval?: number; // seconds, default 300
  debounceMs?: number; // default 5000
  qmdCollection?: string;
  onReindex?: () => Promise<void>;
}

export class SyncDaemon {
  private gitInterval?: NodeJS.Timeout;
  private watcher?: ReturnType<typeof chokidar.watch>;
  private debounceTimer?: NodeJS.Timeout;
  private isRunning = false;
  private opts: Required<SyncDaemonOptions>;

  constructor(opts: SyncDaemonOptions) {
    this.opts = {
      gitPullInterval: 300,
      debounceMs: 5000,
      qmdCollection: 'anvil',
      onReindex: async () => {},
      ...opts,
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Start git pull loop
    this.startGitPullLoop();

    // Start filesystem watcher
    this.startFileWatcher();

    this.log('info', 'Sync daemon started');
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.gitInterval) {
      clearInterval(this.gitInterval);
      this.gitInterval = undefined;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }

    this.log('info', 'Sync daemon stopped');
  }

  private startGitPullLoop(): void {
    const intervalMs = this.opts.gitPullInterval * 1000;
    
    this.gitInterval = setInterval(async () => {
      try {
        const git: SimpleGit = simpleGit(this.opts.notesPath);
        await git.pull(['--ff-only']);
        this.log('info', 'Git pull completed');
        await this.triggerReindex();
      } catch (err) {
        this.log('warn', `Git pull failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, intervalMs);
  }

  private startFileWatcher(): void {
    this.watcher = chokidar.watch(`${this.opts.notesPath}/**/*.md`, {
      ignored: [
        /node_modules/,
        /\.git/,
        /\.anvil\/\.local/,
        /\.tmp$/,
      ],
      persistent: true,
      ignoreInitial: true,
    });

    const scheduleReindex = () => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.triggerReindex().catch((err) => {
          this.log('error', `Re-index failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }, this.opts.debounceMs);
    };

    this.watcher
      .on('add', scheduleReindex)
      .on('change', scheduleReindex)
      .on('unlink', scheduleReindex);

    this.log('info', `Filesystem watcher started on ${this.opts.notesPath}`);
  }

  private async triggerReindex(): Promise<void> {
    try {
      await this.opts.onReindex();
      this.log('debug', 'Re-index triggered');
    } catch (err) {
      this.log('error', `Re-index error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private log(level: string, message: string): void {
    process.stderr.write(
      JSON.stringify({ level, message, timestamp: new Date().toISOString() }) + '\n'
    );
  }
}
