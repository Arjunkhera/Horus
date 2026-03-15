import { Shell } from './components/Shell/Shell'

function SidebarNav() {
  return (
    <nav style={{ padding: '8px 0' }}>
      {[
        { icon: '⌂', label: 'Home',      href: '/' },
        { icon: '◈', label: 'Stories',   href: '/stories' },
        { icon: '◉', label: 'Knowledge', href: '/knowledge' },
        { icon: '⚙', label: 'Settings',  href: '/settings' },
      ].map(({ icon, label, href }) => (
        <a key={href} href={href} style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 12px',
          color: 'var(--text-secondary)',
          textDecoration: 'none',
          borderRadius: '6px',
          margin: '2px 6px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <span style={{ fontSize: '16px', flexShrink: 0 }}>{icon}</span>
          <span style={{ fontSize: '13px' }}>{label}</span>
        </a>
      ))}
    </nav>
  )
}

function TopBar() {
  return (
    <>
      <span style={{ color: 'var(--text-muted)', fontSize: '12px', flex: 1 }}>Query mode</span>
      <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>Home</span>
      <span style={{ marginLeft: 'auto', width: '10px', height: '10px', borderRadius: '50%', background: 'var(--status-green)' }} title="Services healthy" />
    </>
  )
}

export default function App() {
  return (
    <Shell sidebar={<SidebarNav />} topBar={<TopBar />}>
      <div style={{ color: 'var(--text-secondary)', marginTop: '40px', textAlign: 'center' }}>
        <h1 style={{ color: 'var(--text-primary)', fontSize: '24px', marginBottom: '8px' }}>Horus</h1>
        <p>Application shell ready. Navigation and views coming in WI-06/WI-07.</p>
      </div>
    </Shell>
  )
}
