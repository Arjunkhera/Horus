import { useEffect, useState } from 'react'
import { useDashboards } from '../components/Dashboards/DashboardContext'

function greeting() {
  const h = new Date().getHours()
  if (h >= 5 && h < 12)  return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  return 'Good evening'
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

const TYPE_COLORS = {
  story: 'var(--accent)', note: 'var(--status-green)', journal: 'var(--status-yellow)',
  plan: 'var(--text-secondary)',
}

function DashboardCard({ dashboard, onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <div onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
        border: `1px solid ${hover ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: '8px', padding: '20px 16px',
        cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
      }}>
      <span style={{ fontSize: '22px', color: dashboard.color ?? 'var(--accent)' }}>{dashboard.icon ?? '◈'}</span>
      <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', textAlign: 'center' }}>{dashboard.name}</span>
    </div>
  )
}

function AddDashboardCard({ onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <div onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: 'transparent',
        border: `1px dashed ${hover ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: '8px', padding: '20px 16px',
        cursor: 'pointer', transition: 'border-color 0.15s',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
      }}>
      <span style={{ fontSize: '22px', color: 'var(--text-muted)' }}>+</span>
      <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>New Dashboard</span>
    </div>
  )
}

export function HomeView() {
  const { dashboards, setActiveDashboardId, addDashboard } = useDashboards()
  const [userName, setUserName] = useState('')
  const [activity, setActivity] = useState([])
  const [activityLoading, setActivityLoading] = useState(true)

  useEffect(() => {
    fetch('/api/config/preferences')
      .then(r => r.json())
      .then(p => setUserName(p?.user?.name ?? ''))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setActivityLoading(true)
    fetch('/api/anvil/notes?limit=8&sort=modified')
      .then(r => r.ok ? r.json() : { results: [] })
      .then(data => setActivity(data.results ?? data.notes ?? []))
      .catch(() => setActivity([]))
      .finally(() => setActivityLoading(false))
  }, [])

  const handleAddDashboard = async () => {
    const name = prompt('Dashboard name:')
    if (name?.trim()) {
      const id = await addDashboard(name.trim())
      setActiveDashboardId(id)
    }
  }

  return (
    <div style={{ maxWidth: '860px' }}>
      {/* Greeting */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '22px', color: 'var(--text-primary)', marginBottom: '4px' }}>
          {greeting()}{userName ? `, ${userName}` : ''}
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Dashboard cards */}
      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '12px' }}>Pinned</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px' }}>
          {dashboards.map(d => (
            <DashboardCard key={d.id} dashboard={d} onClick={() => setActiveDashboardId(d.id)} />
          ))}
          <AddDashboardCard onClick={handleAddDashboard} />
        </div>
      </section>

      {/* Recent activity */}
      <section>
        <h2 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '12px' }}>Recent Activity</h2>
        {activityLoading
          ? <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading…</p>
          : activity.length === 0
            ? <p style={{ color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic' }}>No recent activity</p>
            : activity.map((item, i) => (
                <div key={item.noteId ?? i} style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '7px 0', borderBottom: '1px solid var(--border-subtle)',
                }}>
                  <span style={{
                    fontSize: '10px', padding: '1px 6px', borderRadius: '8px',
                    background: `${TYPE_COLORS[item.type] ?? 'var(--text-muted)'}22`,
                    color: TYPE_COLORS[item.type] ?? 'var(--text-muted)',
                    flexShrink: 0,
                  }}>{item.type ?? 'note'}</span>
                  <span style={{ flex: 1, fontSize: '13px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0 }}>{relativeTime(item.modified)}</span>
                </div>
              ))
        }
      </section>
    </div>
  )
}
