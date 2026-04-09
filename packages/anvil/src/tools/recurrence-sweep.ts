/**
 * Recurrence sweep service for recurring task management.
 *
 * Deterministic service-level code that generates next recurring
 * task instances on completion and catches up on missed sweeps.
 * NOT agent-driven — all logic is programmatic.
 *
 * @module tools/recurrence-sweep
 */

import type { ToolContext } from './create-note.js'
import { makeError, ERROR_CODES } from '../types/error.js'
import type { AnvilError } from '../types/error.js'

/** Supported recurrence values. */
type RecurrenceValue = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'

/** Result from a sweep operation. */
export interface SweepResult {
  generated: Array<{
    sourceTaskId: string
    sourceTaskTitle: string
    newTaskId: string
    newDueDate: string
  }>
  swept: number
  skipped: number
  errors: string[]
}

/**
 * Compute the next due date given the current due date and recurrence value.
 */
function computeNextDueDate(currentDue: string, recurrence: RecurrenceValue): string {
  const date = new Date(currentDue)

  switch (recurrence) {
    case 'daily':
      date.setDate(date.getDate() + 1)
      break
    case 'weekly':
      date.setDate(date.getDate() + 7)
      break
    case 'biweekly':
      date.setDate(date.getDate() + 14)
      break
    case 'monthly':
      date.setMonth(date.getMonth() + 1)
      break
    case 'quarterly':
      date.setMonth(date.getMonth() + 3)
      break
    case 'yearly':
      date.setFullYear(date.getFullYear() + 1)
      break
  }

  return date.toISOString().split('T')[0]
}

/**
 * Run the recurrence sweep.
 *
 * Scans all completed recurring tasks and generates next instances.
 * Uses last_swept_at watermark to prevent duplicate generation.
 */
export async function handleRecurrenceSweep(
  input: { taskId?: string },
  ctx: ToolContext,
): Promise<SweepResult | AnvilError> {
  const result: SweepResult = {
    generated: [],
    swept: 0,
    skipped: 0,
    errors: [],
  }

  const now = new Date().toISOString()
  const db = ctx.db.raw

  // Find recurring tasks that need sweeping
  let tasks: Array<{
    note_id: string
    title: string
    due: string | null
    recurrence: string
  }>

  if (input.taskId) {
    // Single task sweep (on completion)
    tasks = db.getAll<{ note_id: string; title: string; due: string | null; recurrence: string }>(
      `SELECT note_id, title, due, recurrence
       FROM notes
       WHERE note_id = ? AND type = 'task' AND recurrence IS NOT NULL AND recurrence != ''
         AND status = 'done'`,
      [input.taskId],
    )
  } else {
    // Full sweep (catchup) — find done recurring tasks not yet swept
    tasks = db.getAll<{ note_id: string; title: string; due: string | null; recurrence: string }>(
      `SELECT note_id, title, due, recurrence
       FROM notes
       WHERE type = 'task' AND recurrence IS NOT NULL AND recurrence != ''
         AND status = 'done'
         AND (last_swept_at IS NULL OR last_swept_at < modified)`,
      [],
    )
  }

  for (const task of tasks) {
    result.swept++

    if (!task.due) {
      result.skipped++
      result.errors.push(`Task ${task.note_id} (${task.title}) has no due date — cannot compute next occurrence`)
      continue
    }

    const recurrence = task.recurrence as RecurrenceValue
    const nextDue = computeNextDueDate(task.due, recurrence)

    try {
      // Create next task instance
      const { handleCreateNote } = await import('./create-note.js')
      const createResult = await handleCreateNote(
        {
          type: 'task',
          title: task.title,
          content: undefined,
          fields: {
            status: 'open',
            due: nextDue,
            recurrence: task.recurrence,
          },
        },
        ctx,
      )

      if (createResult && 'noteId' in createResult && !('error' in createResult)) {
        const newTaskId = createResult.noteId as string

        result.generated.push({
          sourceTaskId: task.note_id,
          sourceTaskTitle: task.title,
          newTaskId,
          newDueDate: nextDue,
        })

        // Copy area edges from source task to new instance
        if (ctx.edgeStore) {
          const sourceEdges = await ctx.edgeStore.getEdges(task.note_id, 'belongs_to')
          for (const edge of sourceEdges) {
            if (edge.direction === 'outgoing') {
              await ctx.edgeStore.createEdge({
                sourceId: newTaskId,
                targetId: edge.targetId,
                intent: 'belongs_to',
                description: edge.description,
              })
            }
          }
        }
      } else {
        result.errors.push(`Failed to create next instance for task ${task.note_id}`)
        continue
      }

      // Update last_swept_at on the source task
      db.run('UPDATE notes SET last_swept_at = ? WHERE note_id = ?', [now, task.note_id])
    } catch (err) {
      result.errors.push(`Error sweeping task ${task.note_id}: ${(err as Error).message}`)
    }
  }

  return result
}
