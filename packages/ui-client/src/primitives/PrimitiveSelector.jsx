import { SHAPE } from './PrimitiveRegistry'

const LABELS = {
  [SHAPE.FLAT_ARRAY]:        { icon: '≡', label: 'List' },
  [SHAPE.GROUPED_BY_STATUS]: { icon: '⊞', label: 'Board' },
  [SHAPE.RICH_CARDS]:        { icon: '⊟', label: 'Cards' },
  [SHAPE.TABULAR]:           { icon: '⊞', label: 'Table' },
  [SHAPE.SINGLE_ITEM]:       { icon: '◻', label: 'Item' },
  [SHAPE.MARKDOWN_BODY]:     { icon: 'M↓', label: 'Markdown' },
}

/**
 * PrimitiveSelector toolbar.
 * @param {{ shapes: string[], active: string, onChange: (id: string) => void }} props
 */
export function PrimitiveSelector({ shapes = [], active, onChange }) {
  if (shapes.length <= 1) return null
  return (
    <div style={{ display: 'flex', gap: '4px', padding: '4px 8px' }}>
      {shapes.map(id => {
        const meta = LABELS[id] ?? { icon: '?', label: id }
        const isActive = id === active
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            title={meta.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              background: isActive ? 'var(--bg-tertiary)' : 'transparent',
              border: isActive ? '1px solid var(--border)' : '1px solid transparent',
              borderRadius: '5px',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            <span>{meta.icon}</span>
            <span>{meta.label}</span>
          </button>
        )
      })}
    </div>
  )
}
