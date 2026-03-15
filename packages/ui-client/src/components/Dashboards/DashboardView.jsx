import { useDashboards } from './DashboardContext'

export function DashboardView() {
  const { dashboards, activeDashboardId } = useDashboards()
  const active = dashboards.find(d => d.id === activeDashboardId)

  if (!active) return null

  if (!active.artifact) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: '24px', marginBottom: '8px' }}>{active.icon ?? '◈'}</div>
        <h2 style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>{active.name}</h2>
        <p style={{ fontSize: '13px' }}>No artifact configured yet</p>
      </div>
    )
  }

  // Artifact rendering will be wired up in WI-13/WI-14
  return <div style={{ padding: '16px', color: 'var(--text-secondary)' }}>Artifact: {active.artifact}</div>
}
