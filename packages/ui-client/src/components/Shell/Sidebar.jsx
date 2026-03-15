import { useState, useEffect } from 'react'

const COLLAPSED_WIDTH = '48px'
const EXPANDED_WIDTH  = '220px'
const LS_KEY = 'horus:sidebar:collapsed'

export function Sidebar({ children }) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(LS_KEY) === 'true'
  )

  useEffect(() => {
    localStorage.setItem(LS_KEY, String(collapsed))
  }, [collapsed])

  return (
    <aside style={{
      width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
      minWidth: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
      transition: 'width 0.2s ease, min-width 0.2s ease',
      background: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        borderBottom: '1px solid var(--border)',
        minHeight: '48px',
      }}>
        {!collapsed && (
          <span style={{ fontWeight: 700, color: 'var(--accent)', fontSize: '15px', whiteSpace: 'nowrap' }}>
            ⬡ Horus
          </span>
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '16px',
            padding: '4px 6px',
            borderRadius: '4px',
            lineHeight: 1,
          }}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {children}
      </div>
    </aside>
  )
}
