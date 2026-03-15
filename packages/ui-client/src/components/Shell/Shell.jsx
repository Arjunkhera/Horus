import { Sidebar } from './Sidebar'

export function Shell({ sidebar, topBar, children, chatBar }) {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar>{sidebar}</Sidebar>

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

        {/* Center stage */}
        <main style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}>
          {children}
        </main>

        {/* Chat bar slot */}
        {chatBar && (
          <div style={{
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
          }}>
            {chatBar}
          </div>
        )}
      </div>
    </div>
  )
}
