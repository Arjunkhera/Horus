import { useLocation } from 'react-router-dom'
import { useMode } from '../../context/ModeContext'

const ROUTE_LABELS = {
  '/':          'Home',
  '/stories':   'Stories',
  '/knowledge': 'Knowledge',
  '/settings':  'Settings',
}

export function Breadcrumbs() {
  const location = useLocation()
  const { mode } = useMode()
  const modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1)
  const viewLabel = ROUTE_LABELS[location.pathname] ?? location.pathname.split('/').pop()

  const crumbs = ['Horus', modeLabel, viewLabel].filter(Boolean)

  return (
    <nav style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
      {crumbs.map((crumb, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {i > 0 && <span style={{ color: 'var(--text-muted)' }}>›</span>}
          <span style={{ color: i === crumbs.length - 1 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            {crumb}
          </span>
        </span>
      ))}
    </nav>
  )
}
