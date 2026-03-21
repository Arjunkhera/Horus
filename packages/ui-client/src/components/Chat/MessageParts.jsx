/**
 * Renders message.parts from Vercel AI SDK.
 * Handles text parts, tool activity indicators, and renderView primitives.
 */
import { MarkdownRenderer } from '../MarkdownRenderer/MarkdownRenderer'
import { registry } from '../../primitives/PrimitiveRegistry'
import { adaptRenderView } from '../../adapters/renderViewAdapter'

function ToolActivity({ toolName, state, result }) {
  const displayName = toolName
    .replace('anvil_', 'Anvil: ')
    .replace('knowledge_', 'Vault: ')
    .replace('forge_', 'Forge: ')

  const isLoading = state === 'partial-call' || state === 'call'
  const isDone = state === 'result'
  const resultCount = isDone && result ? (result.results?.length ?? result.total ?? '') : ''

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '4px 8px',
      fontSize: '12px',
      color: 'var(--text-muted)',
      borderRadius: '4px',
      background: 'var(--bg-tertiary)',
      margin: '4px 0',
    }}>
      <span>{isLoading ? '◌' : '✓'}</span>
      <span>{displayName}</span>
      {isDone && resultCount && <span>→ {resultCount} result{resultCount !== 1 ? 's' : ''}</span>}
      {isLoading && <span style={{ animation: 'pulse 1.5s infinite' }}>…</span>}
    </div>
  )
}

function RenderViewPrimitive({ input, onPin }) {
  if (!input?.items?.length) {
    return <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '8px 0' }}>No results to display</div>
  }

  const contract = adaptRenderView(input)
  const selected = registry.selectPrimitive(contract.shape)
  if (!selected) return <div style={{ color: 'var(--text-muted)' }}>Unknown primitive: {input.primitive}</div>

  const Primitive = selected.component

  return (
    <div style={{ margin: '8px 0' }}>
      {input.title && (
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
          {input.title}
        </div>
      )}
      <div style={{
        borderRadius: '8px',
        border: '1px solid var(--border)',
        overflow: 'hidden',
        background: 'var(--bg-secondary)',
      }}>
        <Primitive data={contract} />
      </div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
        {onPin && (
          <button onClick={() => onPin(input)} style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: '4px',
            color: 'var(--text-muted)', cursor: 'pointer', fontSize: '11px', padding: '2px 8px',
          }}>
            📌 Pin
          </button>
        )}
      </div>
    </div>
  )
}

export function MessageParts({ parts, onPin }) {
  if (!parts?.length) return null

  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text') {
          return part.text ? <MarkdownRenderer key={i} content={part.text} /> : null
        }

        if (part.type === 'tool-invocation') {
          const { toolName, state, args, result } = part

          // renderView — render as primitive
          if (toolName === 'renderView') {
            if (state === 'result' || state === 'call') {
              return <RenderViewPrimitive key={i} input={args} onPin={onPin} />
            }
            if (state === 'partial-call') {
              return <div key={i} style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '4px 0' }}>Preparing view…</div>
            }
            return null
          }

          // Other tools — show activity indicator
          return <ToolActivity key={i} toolName={toolName} state={state} result={result} />
        }

        return null
      })}
    </>
  )
}
