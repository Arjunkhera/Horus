/**
 * Pipeline rollback infrastructure for Anvil V2 Ingestion Pipeline.
 *
 * Tracks completed pipeline stages and their undo actions, enabling
 * automatic cleanup when a later stage fails. Undo actions are executed
 * in reverse order (LIFO) so that dependencies are unwound correctly.
 *
 * Rollback failures are logged but never interrupt the remaining undo
 * operations — partial rollback is better than no rollback.
 *
 * @module core/pipeline/rollback
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Ordered stage names matching the ingestion pipeline execution order. */
export type StageName = 'COPY' | 'VALIDATE' | 'PERSIST' | 'GRAPH_SYNC' | 'INDEX'

/**
 * A recorded undo action for a single pipeline stage.
 *
 * The `undo` callback should reverse whatever side-effect the stage
 * produced (e.g. delete a copied file, remove an index entry).
 */
export interface RollbackAction {
  /** Which pipeline stage this action reverses. */
  stage: StageName
  /** Async callback that undoes the stage's side-effect. */
  undo: () => Promise<void>
  /** Human-readable description of what the undo does (for logging). */
  description: string
}

/**
 * Structured error produced when a pipeline stage fails.
 *
 * Contains both the original failure details and the outcome of the
 * automatic rollback attempt so callers can report on partial cleanup.
 */
export interface PipelineError {
  /** The stage that failed. */
  stage: StageName
  /** Human-readable error message. */
  message: string
  /** Arbitrary context about the failure (original error, entity id, etc.). */
  details: Record<string, unknown>
  /** Stages that were successfully rolled back. */
  rolledBack: StageName[]
  /** Stages whose rollback failed, with the error message. */
  rollbackErrors: Array<{ stage: StageName; error: string }>
}

// ---------------------------------------------------------------------------
// RollbackTracker
// ---------------------------------------------------------------------------

/**
 * Tracks completed pipeline stages and executes their undo actions on failure.
 *
 * Usage:
 * ```ts
 * const tracker = new RollbackTracker();
 *
 * // After each successful stage, record its undo action:
 * tracker.record({
 *   stage: 'COPY',
 *   undo: () => fileStore.delete(entityId),
 *   description: `Delete copied file for entity ${entityId}`,
 * });
 *
 * // If a later stage fails, roll everything back:
 * const rolledBack = await tracker.rollback();
 * ```
 */
export class RollbackTracker {
  private readonly actions: RollbackAction[] = []

  /**
   * Record an undo action for a completed stage.
   *
   * Actions are stored in insertion order and will be executed in
   * reverse (LIFO) during rollback.
   */
  record(action: RollbackAction): void {
    this.actions.push(action)
  }

  /**
   * Execute all recorded undo actions in reverse order.
   *
   * Each undo is wrapped in a try/catch so that a failure in one
   * rollback does not prevent the remaining rollbacks from running.
   * Rollback errors are collected internally and surfaced through
   * {@link createPipelineError}.
   *
   * @returns The list of stages that were successfully rolled back.
   */
  async rollback(): Promise<{ rolledBack: StageName[]; rollbackErrors: Array<{ stage: StageName; error: string }> }> {
    const rolledBack: StageName[] = []
    const rollbackErrors: Array<{ stage: StageName; error: string }> = []

    // Execute in reverse order — last recorded stage is undone first.
    const reversed = [...this.actions].reverse()

    for (const action of reversed) {
      try {
        await action.undo()
        rolledBack.push(action.stage)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        rollbackErrors.push({ stage: action.stage, error: message })
        // Log but continue — partial rollback is better than none.
        console.error(
          `[rollback] Failed to undo stage ${action.stage}: ${message}`,
        )
      }
    }

    return { rolledBack, rollbackErrors }
  }

  /**
   * Return the list of stages that have been recorded (in order).
   */
  getCompletedStages(): StageName[] {
    return this.actions.map((a) => a.stage)
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Run rollback on a tracker and assemble a structured {@link PipelineError}.
 *
 * This is the standard way to produce an error from a failed pipeline run:
 *
 * ```ts
 * throw await createPipelineError('PERSIST', 'SQLite write failed', { id }, tracker);
 * ```
 *
 * @param stage   - The stage that failed.
 * @param message - Human-readable error message.
 * @param details - Arbitrary context (entity id, original error, etc.).
 * @param tracker - The RollbackTracker with recorded undo actions.
 * @returns A fully-populated PipelineError after rollback completes.
 */
export async function createPipelineError(
  stage: StageName,
  message: string,
  details: Record<string, unknown>,
  tracker: RollbackTracker,
): Promise<PipelineError> {
  const { rolledBack, rollbackErrors } = await tracker.rollback()

  return {
    stage,
    message,
    details,
    rolledBack,
    rollbackErrors,
  }
}
