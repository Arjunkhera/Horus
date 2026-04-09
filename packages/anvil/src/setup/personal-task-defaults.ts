/**
 * Setup script: Create default nodes for the Personal Task Management system.
 *
 * Creates the default area, view, and dashboard nodes that provide
 * the core daily task management experience. Idempotent — checks
 * for existing nodes before creating.
 *
 * This is run once during system setup or can be triggered on-demand.
 *
 * @module setup/personal-task-defaults
 */

import type { ToolContext } from '../tools/create-note.js'
import { handleCreateNote } from '../tools/create-note.js'
import { isAnvilError } from '../types/error.js'

/** Check if a note with the given title and type already exists. */
function noteExists(ctx: ToolContext, type: string, title: string): string | null {
  const row = ctx.db.raw.getOne<{ note_id: string }>(
    'SELECT note_id FROM notes WHERE type = ? AND title = ?',
    [type, title],
  )
  return row?.note_id ?? null
}

/** Create a note if it doesn't already exist. Returns the noteId. */
async function ensureNote(
  ctx: ToolContext,
  type: string,
  title: string,
  fields: Record<string, unknown>,
  content?: string,
): Promise<string> {
  const existing = noteExists(ctx, type, title)
  if (existing) return existing

  const result = await handleCreateNote(
    { type, title, fields, content },
    ctx,
  )

  if (isAnvilError(result)) {
    throw new Error(`Failed to create ${type} "${title}": ${result.message}`)
  }

  return (result as { noteId: string }).noteId
}

/** Create an edge if the edge store is available. */
async function ensureEdge(
  ctx: ToolContext,
  sourceId: string,
  targetId: string,
  intent: string,
  description?: string,
): Promise<void> {
  if (!ctx.edgeStore) return

  // Check if edge already exists
  const existing = await ctx.edgeStore.getEdges(sourceId, intent)
  const alreadyExists = existing.some(
    (e) => e.direction === 'outgoing' && e.targetId === targetId,
  )
  if (alreadyExists) return

  await ctx.edgeStore.createEdge({
    sourceId,
    targetId,
    intent,
    description,
  })
}

/**
 * Setup result containing all created/found node IDs.
 */
export interface SetupResult {
  areas: { inbox: string; personal: string; office: string }
  views: { today: string; inbox: string; upcoming: string; weeklyReview: string; waitingOn: string }
  dashboards: { morningBriefing: string }
  created: number
  skipped: number
}

/**
 * Create all default nodes for the Personal Task Management system.
 *
 * Idempotent: existing nodes are reused, not duplicated.
 */
export async function setupPersonalTaskDefaults(ctx: ToolContext): Promise<SetupResult> {
  let created = 0
  let skipped = 0

  const countAndReturn = async (
    type: string,
    title: string,
    fields: Record<string, unknown>,
    content?: string,
  ): Promise<string> => {
    const existing = noteExists(ctx, type, title)
    if (existing) {
      skipped++
      return existing
    }
    created++
    return ensureNote(ctx, type, title, fields, content)
  }

  // --- Areas ---
  const inboxId = await countAndReturn('area', 'Inbox', {
    description: 'Default landing zone for quick capture. Triage items here.',
  })

  const personalId = await countAndReturn('area', 'Personal', {
    description: 'Personal life tasks and notes',
  })

  const officeId = await countAndReturn('area', 'Office', {
    description: 'Work-related tasks and notes',
  })

  // --- Views ---
  const todayId = await countAndReturn('view', 'Today', {
    query: {
      type: 'task',
      status: 'open',
      due: { lte: new Date().toISOString().split('T')[0] },
    },
    format: 'list',
    sort_by: 'due',
    description: 'Tasks due today and overdue, grouped by area',
  })

  const inboxViewId = await countAndReturn('view', 'Inbox', {
    query: {
      type: 'task',
    },
    format: 'list',
    sort_by: 'created',
    description: 'Tasks in the Inbox area, sorted by newest first',
  })

  const upcomingId = await countAndReturn('view', 'Upcoming', {
    query: {
      type: 'task',
      status: 'open',
      due: {
        gte: new Date().toISOString().split('T')[0],
        lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      },
    },
    format: 'list',
    sort_by: 'due',
    description: 'Tasks due this week, sorted by due date',
  })

  const weeklyReviewId = await countAndReturn('view', 'Weekly Review', {
    query: {
      type: 'task',
      modified: {
        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      },
    },
    format: 'table',
    group_by: 'status',
    description: 'Tasks modified this week — completed, open, and rolled over',
  })

  const waitingOnId = await countAndReturn('view', 'Waiting On', {
    query: {
      type: 'task',
      status: 'blocked',
    },
    format: 'list',
    description: 'Tasks currently blocked or waiting on something',
  })

  // --- Dashboard ---
  const morningBriefingId = await countAndReturn('dashboard', 'Morning Briefing', {
    description: 'Daily overview: Today + Inbox count + Upcoming this week',
    layout: 'vertical',
  })

  // --- Dashboard → View edges ---
  await ensureEdge(ctx, morningBriefingId, todayId, 'parent_of', 'Dashboard contains Today view')
  await ensureEdge(ctx, morningBriefingId, inboxViewId, 'parent_of', 'Dashboard contains Inbox view')
  await ensureEdge(ctx, morningBriefingId, upcomingId, 'parent_of', 'Dashboard contains Upcoming view')

  return {
    areas: { inbox: inboxId, personal: personalId, office: officeId },
    views: { today: todayId, inbox: inboxViewId, upcoming: upcomingId, weeklyReview: weeklyReviewId, waitingOn: waitingOnId },
    dashboards: { morningBriefing: morningBriefingId },
    created,
    skipped,
  }
}
