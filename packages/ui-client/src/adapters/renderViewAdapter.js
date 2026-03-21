/**
 * Adapts renderView tool output to the DataContract format
 * that Phase 1 primitives expect.
 */

const PRIMITIVE_TO_SHAPE = {
  board: 'grouped-by-status',
  table: 'tabular',
  list: 'flat-array',
  cards: 'rich-cards',
}

function inferSource(items) {
  if (!items?.length) return 'anvil'
  const first = items[0]
  if (first.source) return first.source
  if (first.noteId) return 'anvil'
  if (first.relevance_score !== undefined) return 'vault'
  return 'anvil'
}

function inferType(items) {
  if (!items?.length) return 'note'
  const first = items[0]
  return first.type ?? first.source_type ?? 'note'
}

function normalizeItems(items) {
  return (items ?? []).map(item => ({
    id: item.id ?? item.noteId ?? item.path ?? String(Math.random()),
    title: item.title ?? 'Untitled',
    status: item.status,
    priority: item.priority,
    tags: item.tags,
    modified: item.modified ?? item.modified_at,
    body: item.body ?? item.description ?? item.snippet,
    ...item,
  }))
}

export function adaptRenderView(input) {
  const shape = PRIMITIVE_TO_SHAPE[input.primitive] ?? 'flat-array'
  const items = normalizeItems(input.items)

  return {
    query: input.title || '',
    source: inferSource(input.items),
    type: inferType(input.items),
    count: items.length,
    items,
    shape,
  }
}
