/**
 * Renders message.parts from Vercel AI SDK.
 * Handles text parts, tool activity indicators, and renderView primitives.
 */
import { useState } from 'react'
import { MarkdownRenderer } from '../MarkdownRenderer/MarkdownRenderer'
import { registry } from '../../primitives/PrimitiveRegistry'
import { PrimitiveSelector } from '../../primitives/PrimitiveSelector'
import { adaptRenderView } from '../../adapters/renderViewAdapter'

function ToolActivity({ toolName, state, output }) {
  const [expanded, setExpanded] = useState(false)

  const displayName = toolName
    .replace('anvil_', 'Anvil: ')
    .replace('knowledge_', 'Vault: ')
    .replace('forge_', 'Forge: ')

  // AI SDK v4+ states: input-streaming, input-available, output-available, output-error
  const isLoading = state === 'input-streaming' || state === 'input-available'
  const isDone = state === 'output-available'
  const isError = state === 'output-error' || (isDone && (output?.error || output?.isError))
  const resultCount = isDone && !isError && output ? (output.results?.length ?? output.total ?? '') : ''

  return (
    <div style={{ margin: '4px 0' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px 8px',
          fontSize: '12px',
          color: isError ? 'var(--text-error, #ef4444)' : 'var(--text-muted)',
          borderRadius: '4px',
          background: isError ? 'var(--bg-error, rgba(239,68,68,0.1))' : 'var(--bg-tertiary)',
          cursor: isDone ? 'pointer' : 'default',
        }}
        onClick={isDone ? () => setExpanded(e => !e) : undefined}
      >
        <span>{isLoading ? '◌' : isError ? '✗' : '✓'}</span>
        <span>{displayName}</span>
        {isError && <span>— {output?.error?.message || output?.error || 'tool error'}</span>}
        {isDone && !isError && resultCount !== '' && <span>→ {resultCount} result{resultCount !== 1 ? 's' : ''}</span>}
        {isLoading && <span style={{ animation: 'pulse 1.5s infinite' }}>…</span>}
        {isDone && <span style={{ marginLeft: 'auto', fontSize: '10px' }}>{expanded ? '▼' : '▶'}</span>}
      </div>
      {expanded && isDone && output && (
        <pre style={{
          margin: '2px 0 0',
          padding: '8px',
          fontSize: '11px',
          background: 'var(--bg-tertiary)',
          borderRadius: '0 0 4px 4px',
          overflow: 'auto',
          maxHeight: '200px',
          color: 'var(--text-secondary)',
        }}>
          {JSON.stringify(output, null, 2)}
        </pre>
      )}
    </div>
  )
}

function RenderViewPrimitive({ input, onPin }) {
  const [shapeOverride, setShapeOverride] = useState(null)

  if (!input?.items?.length) {
    return <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '8px 0' }}>No results to display</div>
  }

  const contract = adaptRenderView(input)
  const selected = registry.selectPrimitive(contract.shape, shapeOverride)
  if (!selected) return <div style={{ color: 'var(--text-muted)' }}>Unknown primitive: {input.primitive}</div>

  const Primitive = selected.component
  const availableShapes = registry.getPrimitivesForShape(contract.shape).map(p => p.id)

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
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
        {onPin && (
          <button onClick={() => onPin(input)} style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: '4px',
            color: 'var(--text-muted)', cursor: 'pointer', fontSize: '11px', padding: '2px 8px',
          }}>
            Pin
          </button>
        )}
        <PrimitiveSelector
          shapes={availableShapes.length > 1 ? availableShapes : registry.getAll()}
          active={selected.id}
          onChange={setShapeOverride}
        />
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

        // AI SDK v4+: tool parts have type "tool-{toolName}", state, input, output
        if (part.type.startsWith('tool-')) {
          const toolName = part.type.slice(5) // strip "tool-" prefix
          const { state, input, output } = part

          // renderView — render as primitive
          if (toolName === 'renderView') {
            if (state === 'input-available' || state === 'output-available') {
              return <RenderViewPrimitive key={i} input={input} onPin={onPin} />
            }
            if (state === 'input-streaming') {
              return <div key={i} style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '4px 0' }}>Preparing view…</div>
            }
            return null
          }

          // Other tools — show activity indicator
          return <ToolActivity key={i} toolName={toolName} state={state} output={output} />
        }

        // Skip step-start and other internal part types
        return null
      })}
    </>
  )
}
