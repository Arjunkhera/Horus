type Priority = 'high' | 'low';

interface QueueEntry {
  resolve: (release: () => void) => void;
  priority: Priority;
}

/**
 * Single-holder async mutex with priority queuing.
 * Push acquires at 'high' priority so it jumps ahead of queued pulls.
 * No built-in timeout — callers set timeouts on the git operations inside
 * the critical section (via simple-git's timeout option).
 */
export class GitMutex {
  private held = false;
  private queue: QueueEntry[] = [];

  async acquire(priority: Priority = 'low'): Promise<() => void> {
    if (!this.held) {
      this.held = true;
      return this.createRelease();
    }

    return new Promise<() => void>((resolve) => {
      const entry: QueueEntry = { resolve, priority };

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
        next.resolve(this.createRelease());
      } else {
        this.held = false;
      }
    };
  }
}
