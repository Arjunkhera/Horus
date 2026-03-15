import { useMode, MODES } from '../../context/ModeContext'

export function ModeSelector() {
  const { mode, setMode } = useMode()
  return (
    <div style={{ display: 'flex', gap: '2px', background: 'var(--bg-tertiary)', borderRadius: '6px', padding: '2px' }}>
      {MODES.map(({ id, label }) => {
        const active = mode === id
        return (
          <button key={id} onClick={() => setMode(id)} style={{
            padding: '4px 10px',
            background: active ? 'var(--bg-secondary)' : 'transparent',
            border: active ? '1px solid var(--border)' : '1px solid transparent',
            borderRadius: '4px',
            color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: active ? 600 : 400,
          }}>
            {label}
          </button>
        )
      })}
    </div>
  )
}
