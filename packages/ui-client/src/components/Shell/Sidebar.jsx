import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'

const COLLAPSED_WIDTH = '48px'
const EXPANDED_WIDTH  = '240px'
const LS_KEY = 'horus:sidebar:collapsed'

const NAV = [
  { icon: '⌂', label: 'Home',      to: '/' },
  { icon: '⚙', label: 'Settings',  to: '/settings' },
]

export function Sidebar({ pinnedSection, conversationList }) {
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
      {/* Header */}
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

      {/* Conversations */}
      {conversationList && !collapsed && (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '8px 12px 4px', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Chats
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {conversationList}
          </div>
        </div>
      )}

      {/* Pinned dashboards */}
      {pinnedSection && !collapsed && (
        <div style={{ overflow: 'hidden', borderTop: '1px solid var(--border)' }}>
          <div style={{ padding: '8px 12px 4px', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Pinned
          </div>
          {pinnedSection}
        </div>
      )}

      {/* Nav links */}
      <nav style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
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
    </aside>
  )
}
