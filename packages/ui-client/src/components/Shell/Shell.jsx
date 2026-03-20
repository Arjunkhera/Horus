export function Shell({ sidebar, topBar, children }) {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {sidebar}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top bar */}
        <header style={{
          height: '48px',
          minHeight: '48px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          gap: '12px',
        }}>
          {topBar}
        </header>

        {/* Center stage — chat or route content */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {children}
        </div>
      </div>
    </div>
  )
}
