export interface SyncHealthState {
  daemonAlive: boolean;
  lastCycleAt: string | null;

  lastPushAttempt: string | null;
  lastPushSuccess: string | null;
  lastPushError: string | null;
  pushConsecutiveFailures: number;

  lastPullAttempt: string | null;
  lastPullSuccess: string | null;
  lastPullError: string | null;
  pullConsecutiveFailures: number;

  aheadBy: number;
  behindBy: number;
  pendingFiles: number;

  conflictBranch: string | null;
  lastConflict: string | null;
}

export function createInitialHealthState(): SyncHealthState {
  return {
    daemonAlive: false,
    lastCycleAt: null,
    lastPushAttempt: null,
    lastPushSuccess: null,
    lastPushError: null,
    pushConsecutiveFailures: 0,
    lastPullAttempt: null,
    lastPullSuccess: null,
    lastPullError: null,
    pullConsecutiveFailures: 0,
    aheadBy: 0,
    behindBy: 0,
    pendingFiles: 0,
    conflictBranch: null,
    lastConflict: null,
  };
}

const PUSH_STALE_MS = 10 * 60 * 1000; // 10 minutes
const CYCLE_STALE_MS = 3 * 60 * 1000; // 3 minutes (3x the default 60s pull interval)

/**
 * Critical when data safety is at risk: push pipeline broken, conflict detected,
 * or sync loop has stopped cycling.
 */
export function isHealthCritical(state: SyncHealthState): boolean {
  if (state.pushConsecutiveFailures >= 3) return true;
  if (state.conflictBranch !== null) return true;

  if (
    state.lastPushAttempt !== null &&
    state.lastPushSuccess !== null &&
    Date.now() - new Date(state.lastPushSuccess).getTime() > PUSH_STALE_MS
  ) {
    return true;
  }

  if (state.lastPushAttempt !== null && state.lastPushSuccess === null) {
    return true;
  }

  // Detect dead sync loop: daemon claims alive but no cycle in 3x the interval
  if (
    state.daemonAlive &&
    state.lastCycleAt !== null &&
    Date.now() - new Date(state.lastCycleAt).getTime() > CYCLE_STALE_MS
  ) {
    return true;
  }

  return false;
}

/**
 * Degraded when pull pipeline is broken — local data is safe (push works)
 * but we're not receiving remote updates.
 */
export function isHealthDegraded(state: SyncHealthState): boolean {
  return state.pullConsecutiveFailures >= 3;
}

/**
 * HTTP status for the /health endpoint.
 * 503 if critical (load balancers should stop routing), 200 otherwise.
 * Degraded is still 200 — the server can accept writes even if pulls are failing.
 */
export function healthHttpStatus(state: SyncHealthState): number {
  return isHealthCritical(state) ? 503 : 200;
}
