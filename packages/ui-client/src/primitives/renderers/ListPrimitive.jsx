import { useState } from 'react'

const STATUS_COLORS = {
  open: 'var(--status-green)', 'in-progress': 'var(--accent)',
  blocked: 'var(--status-red)', done: 'var(--text-muted)',
  cancelled: 'var(--text-muted)', draft: 'var(--status-yellow)',
}

function relativeTime(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const PRIORITY_DOT = { 'P0-critical': '#f85149', 'P1-high': '#d29922', 'P2-medium': '#58a6ff', 'P3-low': '#484f58' }

export function ListPrimitive({ data, config = {} }) {
  const { density = 'compact' } = config
  const rowPad = density === 'spacious' ? '10px 12px' : density === 'comfortable' ? '7px 12px' : '4px 12px'

  const [sort, setSort] = useState({ col: 'modified', dir: 'desc' })
  const items = [...(data?.items ?? [])]

  items.sort((a, b) => {
    const av = a[sort.col] ?? '', bv = b[sort.col] ?? ''
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sort.dir === 'asc' ? cmp : -cmp
  })

  const toggleSort = col => setSort(s => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }))
  const sortIcon = col => sort.col === col ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''

  if (!items.length) return <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '16px' }}>No items to display</p>

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 80px 80px', background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border)' }}>
        {['title', 'status', 'priority', 'modified'].map(col => (
          <div key={col} onClick={() => toggleSort(col)} style={{
            padding: '6px 12px', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.5px', cursor: 'pointer',
            userSelect: 'none',
          }}>
            {col}{sortIcon(col)}
          </div>
        ))}
      </div>
      {items.map((item, i) => (
        <div key={item.id ?? i} style={{
          display: 'grid', gridTemplateColumns: '1fr 90px 80px 80px',
          borderBottom: i < items.length - 1 ? '1px solid var(--border-subtle)' : 'none',
        }}>
          <div style={{ padding: rowPad, fontSize: '13px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
          <div style={{ padding: rowPad, display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '10px', background: `${STATUS_COLORS[item.status] ?? 'var(--text-muted)'}22`, color: STATUS_COLORS[item.status] ?? 'var(--text-muted)' }}>
              {item.status ?? '—'}
            </span>
          </div>
          <div style={{ padding: rowPad, display: 'flex', alignItems: 'center', gap: '4px' }}>
            {item.priority && <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: PRIORITY_DOT[item.priority] ?? 'var(--text-muted)', flexShrink: 0 }} />}
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.priority?.replace('P', '') ?? ''}</span>
          </div>
          <div style={{ padding: rowPad, fontSize: '11px', color: 'var(--text-muted)' }}>{relativeTime(item.modified)}</div>
        </div>
      ))}
    </div>
  )
}
