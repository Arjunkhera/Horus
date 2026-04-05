import { useState } from 'react'
import { useHealth } from '../../hooks/useHealth'

const DOT_COLOR = {
  healthy:   'var(--status-green)',
  degraded:  'var(--status-yellow)',
  unhealthy: 'var(--status-red)',
  unreachable: 'var(--status-red)',
  unknown:   'var(--text-muted)',
}

const LABEL = {
  healthy:   'all systems healthy',
  degraded:  (n) => `${n} service${n > 1 ? 's' : ''} degraded`,
  unhealthy: (n) => `${n} service${n > 1 ? 's' : ''} down`,
  unknown:   'checking…',
}

function label(overall, services) {
  if (overall === 'healthy') return LABEL.healthy
  if (overall === 'degraded') { const n = services.filter(s => s.status !== 'healthy').length; return LABEL.degraded(n) }
  if (overall === 'unhealthy') { const n = services.filter(s => s.status !== 'healthy').length; return LABEL.unhealthy(n) }
  return LABEL.unknown
}

/** Format an ISO timestamp as a short relative string, e.g. "just now", "2m ago" */
function relativeTime(iso) {
  if (!iso) return null
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 10) return 'just now'
  if (diff < 60) return `${diff}s ago`
  return `${Math.floor(diff / 60)}m ago`
}

function Modal({ health, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: '10px', padding: '20px', width: '360px', maxHeight: '80vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ color: 'var(--text-primary)', fontSize: '15px' }}>Service Health</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '18px' }}>×</button>
        </div>
        {health.services.map(svc => (
          <div key={svc.name} style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '10px 12px', background: 'var(--bg-tertiary)',
            borderRadius: '6px', marginBottom: '8px',
          }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: DOT_COLOR[svc.status] ?? 'var(--text-muted)', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', textTransform: 'capitalize' }}>{svc.name}</span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{svc.url?.split(':').pop()}</span>
            <span style={{ fontSize: '11px', color: DOT_COLOR[svc.status] ?? 'var(--text-muted)' }}>{svc.status}</span>
            {svc.latency != null && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{svc.latency}ms</span>}
          </div>
        ))}
        {health.checkedAt && (
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', marginBottom: '8px', textAlign: 'right' }}>
            checked {relativeTime(health.checkedAt)}
          </div>
        )}
        <button
          onClick={() => fetch('/api/services/restart', { method: 'POST' }).then(() => health.refresh())}
          style={{
            marginTop: '4px', width: '100%', padding: '8px',
            background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
            borderRadius: '6px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px',
          }}>
          Restart All
        </button>
      </div>
    </div>
  )
}

export function HealthIndicator() {
  const health = useHealth()
  const [open, setOpen] = useState(false)
  const color = DOT_COLOR[health.overall] ?? 'var(--text-muted)'

  return (
    <>
      <button onClick={() => setOpen(true)} style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: '4px',
      }}>
        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{label(health.overall, health.services)}</span>
      </button>
      {open && <Modal health={health} onClose={() => setOpen(false)} />}
    </>
  )
}
