/**
 * MCP tool handler: anvil_execute_dashboard
 *
 * Executes all views linked to a dashboard node via parent_of edges,
 * combining their results into a single response.
 *
 * @module tools/execute-dashboard
 */

import type { ToolContext } from './create-note.js'
import { makeError, ERROR_CODES } from '../types/error.js'
import type { AnvilError } from '../types/error.js'
import { handleExecuteView } from './execute-view.js'

export interface ExecuteDashboardInput {
  /** UUID of the dashboard node to execute. */
  dashboardId: string
}

interface DashboardSection {
  viewId: string
  viewTitle: string
  format: string
  results: unknown[]
  total: number
  groups?: Record<string, unknown[]>
}

interface ExecuteDashboardResult {
  dashboardTitle: string
  sections: DashboardSection[]
  totalViews: number
}

/**
 * Execute a dashboard by walking its parent_of edges to child views
 * and executing each view in order.
 */
export async function handleExecuteDashboard(
  input: ExecuteDashboardInput,
  ctx: ToolContext,
): Promise<ExecuteDashboardResult | AnvilError> {
  if (!input.dashboardId) {
    return makeError(ERROR_CODES.VALIDATION_ERROR, 'dashboardId is required')
  }

  if (!ctx.edgeStore) {
    return makeError(ERROR_CODES.SERVER_ERROR, 'V2 graph subsystem not available — Neo4j required')
  }

  // 1. Look up the dashboard note
  const dashboardRow = ctx.db.raw.getOne<{ note_id: string; type: string; title: string }>(
    'SELECT note_id, type, title FROM notes WHERE note_id = ?',
    [input.dashboardId],
  )

  if (!dashboardRow) {
    return makeError(ERROR_CODES.NOT_FOUND, `Dashboard not found: ${input.dashboardId}`)
  }

  if (dashboardRow.type !== 'dashboard') {
    return makeError(
      ERROR_CODES.VALIDATION_ERROR,
      `Note ${input.dashboardId} is not a dashboard (type: ${dashboardRow.type})`,
    )
  }

  // 2. Get child views via parent_of edges
  const children = await ctx.edgeStore.getChildren(input.dashboardId, { intent: 'parent_of' })

  if (children.length === 0) {
    return {
      dashboardTitle: dashboardRow.title,
      sections: [],
      totalViews: 0,
    }
  }

  // 3. Execute each child view
  const sections: DashboardSection[] = []

  for (const child of children) {
    const viewResult = await handleExecuteView({ viewId: child.id }, ctx)

    if ('error' in viewResult) {
      // Skip views that fail rather than aborting the whole dashboard
      sections.push({
        viewId: child.id,
        viewTitle: child.title,
        format: 'error',
        results: [],
        total: 0,
        groups: { error: [viewResult.message] },
      })
      continue
    }

    sections.push({
      viewId: child.id,
      viewTitle: viewResult.viewTitle,
      format: viewResult.format,
      results: viewResult.results,
      total: viewResult.total,
      groups: viewResult.groups,
    })
  }

  return {
    dashboardTitle: dashboardRow.title,
    sections,
    totalViews: children.length,
  }
}
