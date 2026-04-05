const STATUS_COLORS = {
  open: 'var(--status-green)', 'in-progress': 'var(--accent)',
  blocked: 'var(--status-red)', done: 'var(--text-muted)', cancelled: 'var(--text-muted)',
}

export function CardsPrimitive({ data, config = {} }) {
  const items = data?.items ?? []
  const { columns = 3, showTags = true, showPreview = true } = config

  if (!items.length) return <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '16px' }}>No items</p>

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: '12px' }}>
      {items.map((item, i) => (
        <div key={item.id ?? i} style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: '8px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px',
        }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>{item.title}</div>

          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '11px' }}>
            {item.status && (
              <span style={{ padding: '1px 6px', borderRadius: '10px', background: `${STATUS_COLORS[item.status] ?? 'var(--text-muted)'}22`, color: STATUS_COLORS[item.status] ?? 'var(--text-muted)' }}>
                {item.status}
              </span>
            )}
            {item.priority && <span style={{ color: 'var(--text-muted)' }}>{item.priority}</span>}
          </div>

          {showTags && item.tags?.length > 0 && (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {item.tags.map(tag => (
                <span key={tag} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '10px', background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>{tag}</span>
              ))}
            </div>
          )}

          {showPreview && item.body && (
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
              {item.body.slice(0, 180)}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
