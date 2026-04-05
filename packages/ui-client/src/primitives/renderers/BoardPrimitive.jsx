const PRIORITY_COLOR = { 'P0-critical': '#f85149', 'P1-high': '#d29922', 'P2-medium': '#58a6ff', 'P3-low': '#484f58' }

function Card({ item }) {
  return (
    <div style={{
      background: 'var(--bg-primary)', border: '1px solid var(--border)',
      borderRadius: '6px', padding: '8px 10px', marginBottom: '6px',
    }}>
      <div style={{ fontSize: '13px', color: 'var(--text-primary)', marginBottom: '4px', lineHeight: 1.3 }}>{item.title}</div>
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
        {item.priority && (
          <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '8px', border: `1px solid ${PRIORITY_COLOR[item.priority] ?? 'var(--border)'}`, color: PRIORITY_COLOR[item.priority] ?? 'var(--text-muted)' }}>
            {item.priority}
          </span>
        )}
        {(item.tags ?? []).slice(0, 3).map(tag => (
          <span key={tag} style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '8px', background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>{tag}</span>
        ))}
        {(item.tags?.length ?? 0) > 3 && <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>+{item.tags.length - 3}</span>}
      </div>
    </div>
  )
}

export function BoardPrimitive({ data, config = {} }) {
  const items = data?.items ?? []
  const { maxItemsPerColumn = 50 } = config

  // Derive columns from unique status values
  const statusOrder = config.columns ?? [...new Set(items.map(i => i.status).filter(Boolean))]
  const grouped = {}
  statusOrder.forEach(s => { grouped[s] = [] })
  items.forEach(item => {
    const s = item.status ?? 'unknown'
    if (!grouped[s]) grouped[s] = []
    grouped[s].push(item)
  })

  if (!items.length) return <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '16px' }}>No items</p>

  return (
    <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', alignItems: 'flex-start', paddingBottom: '8px' }}>
      {statusOrder.map(status => {
        const col = (grouped[status] ?? []).slice(0, maxItemsPerColumn)
        return (
          <div key={status} style={{ minWidth: '220px', maxWidth: '260px', flexShrink: 0 }}>
            <div style={{
              padding: '6px 10px', marginBottom: '8px', borderRadius: '4px',
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)',
              textTransform: 'uppercase', letterSpacing: '0.5px',
              display: 'flex', justifyContent: 'space-between',
            }}>
              {status}
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{col.length}</span>
            </div>
            {col.length === 0
              ? <p style={{ color: 'var(--text-muted)', fontSize: '12px', fontStyle: 'italic', padding: '4px 2px' }}>No items</p>
              : col.map((item, i) => <Card key={item.id ?? i} item={item} />)
            }
          </div>
        )
      })}
    </div>
  )
}
