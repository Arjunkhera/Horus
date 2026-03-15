import { useState, useMemo } from 'react'

export function TablePrimitive({ data, config = {} }) {
  const items = data?.items ?? []
  const [sort, setSort] = useState({ col: null, dir: 'asc' })

  const columns = useMemo(() => {
    if (config.columns?.length) return config.columns
    const keys = new Set()
    items.forEach(item => Object.keys(item).forEach(k => keys.add(k)))
    return [...keys]
  }, [items, config.columns])

  const sorted = useMemo(() => {
    if (!sort.col) return items
    return [...items].sort((a, b) => {
      const av = String(a[sort.col] ?? ''), bv = String(b[sort.col] ?? '')
      return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
  }, [items, sort])

  const toggleSort = col => setSort(s => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }))

  if (!items.length) return <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '16px' }}>No data</p>

  const density = config.density ?? 'compact'
  const cellPad = density === 'spacious' ? '10px 12px' : density === 'comfortable' ? '7px 12px' : '4px 12px'

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '6px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ background: 'var(--bg-secondary)' }}>
            {columns.map(col => (
              <th key={col} onClick={() => toggleSort(col)} style={{
                padding: cellPad, textAlign: 'left', fontSize: '11px', fontWeight: 600,
                color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px',
                borderBottom: '2px solid var(--border)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
              }}>
                {col}{sort.col === col ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((item, i) => (
            <tr key={item.id ?? i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {columns.map(col => (
                <td key={col} style={{ padding: cellPad, color: 'var(--text-primary)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item[col] != null ? String(item[col]) : ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
