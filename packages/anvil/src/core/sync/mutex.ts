type Priority = 'high' | 'low';

interface QueueEntry {
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
  priority: Priority;
  timer?: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Single-holder async mutex with priority queuing and acquire timeout.
 * Push acquires at 'high' priority so it jumps ahead of queued pulls.
 * If a caller waits longer than timeoutMs for the lock, it rejects
 * with an error instead of blocking forever.
 */
export class GitMutex {
  private held = false;
  private queue: QueueEntry[] = [];

  async acquire(
    priority: Priority = 'low',
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<() => void> {
    if (!this.held) {
      this.held = true;
      return this.createRelease();
    }

    return new Promise<() => void>((resolve, reject) => {
      const entry: QueueEntry = { resolve, reject, priority };

      entry.timer = setTimeout(() => {
        const idx = this.queue.indexOf(entry);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          reject(new Error(`GitMutex acquire timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      if (priority === 'high') {
        const firstLowIdx = this.queue.findIndex((e) => e.priority === 'low');
        if (firstLowIdx === -1) {
          this.queue.push(entry);
        } else {
          this.queue.splice(firstLowIdx, 0, entry);
        }
      } else {
        this.queue.push(entry);
      }
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      const next = this.queue.shift();
      if (next) {
        if (next.timer) clearTimeout(next.timer);
        next.resolve(this.createRelease());
      } else {
        this.held = false;
      }
    };
  }
}
