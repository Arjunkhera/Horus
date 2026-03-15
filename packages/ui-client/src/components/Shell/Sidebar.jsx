import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'

const COLLAPSED_WIDTH = '48px'
const EXPANDED_WIDTH  = '220px'
const LS_KEY = 'horus:sidebar:collapsed'

const NAV = [
  { icon: '⌂', label: 'Home',      to: '/' },
  { icon: '◈', label: 'Stories',   to: '/stories' },
  { icon: '◉', label: 'Knowledge', to: '/knowledge' },
  { icon: '⚙', label: 'Settings',  to: '/settings' },
]

export function Sidebar({ pinnedSection }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(LS_KEY) === 'true')
  useEffect(() => { localStorage.setItem(LS_KEY, String(collapsed)) }, [collapsed])

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
        {!collapsed && <span style={{ fontWeight: 700, color: 'var(--accent)', fontSize: '15px', whiteSpace: 'nowrap' }}>⬡ Horus</span>}
        <button onClick={() => setCollapsed(c => !c)} style={{
          background: 'none', border: 'none', color: 'var(--text-secondary)',
          cursor: 'pointer', fontSize: '16px', padding: '4px 6px', borderRadius: '4px', lineHeight: 1,
        }}>
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      <nav style={{ padding: '8px 0' }}>
        {NAV.map(({ icon, label, to }) => (
          <NavLink key={to} to={to} end={to === '/'} style={({ isActive }) => ({
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '8px 12px', textDecoration: 'none', borderRadius: '6px',
            margin: '2px 6px', whiteSpace: 'nowrap', overflow: 'hidden',
            color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
            background: isActive ? 'var(--bg-tertiary)' : 'transparent',
          })}>
            <span style={{ fontSize: '16px', flexShrink: 0 }}>{icon}</span>
            {!collapsed && <span style={{ fontSize: '13px' }}>{label}</span>}
          </NavLink>
        ))}
      </nav>

      {pinnedSection && !collapsed && (
        <div style={{ flex: 1, overflow: 'hidden', borderTop: '1px solid var(--border)' }}>
          {pinnedSection}
        </div>
      )}
    </aside>
  )
}
