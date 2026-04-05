import { useState } from 'react'
import { useDashboards } from './DashboardContext'

export function PinnedSection() {
  const { dashboards, activeDashboardId, setActiveDashboardId, addDashboard, reorder } = useDashboards()
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const filtered = dashboards.filter(d => d.name.toLowerCase().includes(filter.toLowerCase()))

  const confirmAdd = async () => {
    if (newName.trim()) await addDashboard(newName.trim())
    setNewName('')
    setAdding(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px 4px' }}>
        <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Pinned</span>
        <button onClick={() => setAdding(true)} title="Add dashboard" style={{
          background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
          fontSize: '16px', lineHeight: 1, padding: '1px 4px', borderRadius: '3px',
        }}>+</button>
      </div>

      {/* Search */}
      <div style={{ padding: '0 8px 4px' }}>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter…" style={{
          width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
          borderRadius: '4px', color: 'var(--text-primary)', fontSize: '12px', padding: '4px 8px',
        }} />
      </div>

      {/* Inline add */}
      {adding && (
        <div style={{ padding: '0 8px 4px' }}>
          <input
            autoFocus value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') confirmAdd(); if (e.key === 'Escape') { setAdding(false); setNewName('') } }}
            placeholder="Dashboard name…"
            style={{ width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--accent)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '12px', padding: '4px 8px' }}
          />
        </div>
      )}

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 && filter && (
          <p style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No match</p>
        )}
        {filtered.map((d, idx) => (
          <div key={d.id} style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '6px 12px', cursor: 'pointer', borderRadius: '5px', margin: '1px 4px',
            background: activeDashboardId === d.id ? 'var(--bg-tertiary)' : 'transparent',
            color: activeDashboardId === d.id ? 'var(--text-primary)' : 'var(--text-secondary)',
          }}
            onClick={() => setActiveDashboardId(d.id)}
          >
            <span style={{ color: d.color ?? 'var(--accent)', flexShrink: 0 }}>{d.icon ?? '◈'}</span>
            <span style={{ flex: 1, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
            <span style={{ display: 'flex', gap: '1px', flexShrink: 0 }}>
              {idx > 0 && <button onClick={e => { e.stopPropagation(); reorder(idx, idx - 1) }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '10px', padding: '1px' }}>↑</button>}
              {idx < filtered.length - 1 && <button onClick={e => { e.stopPropagation(); reorder(idx, idx + 1) }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '10px', padding: '1px' }}>↓</button>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
