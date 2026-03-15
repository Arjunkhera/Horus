import { useState, useRef } from 'react'
import { useMode } from '../../context/ModeContext'
import { registry } from '../../primitives/PrimitiveRegistry'
import { PrimitiveSelector } from '../../primitives/PrimitiveSelector'

const PLACEHOLDERS = {
  anvil: 'Search Anvil notes…',
  vault: 'Search Vault knowledge…',
  forge: 'Search Forge packages…',
}

function detectShape(results) {
  if (!results || !Array.isArray(results)) return 'flat-array'
  if (results.length > 0 && results[0].status !== undefined) return 'grouped-by-status'
  return 'flat-array'
}

function normalizeResponse(raw, query, mode) {
  const items = raw?.results ?? raw?.notes ?? raw?.pages ?? raw?.items ?? (Array.isArray(raw) ? raw : [])
  const shape = detectShape(items)
  return { query, source: mode, type: 'search', count: items.length, items, shape }
}

export function ChatBar({ onResults }) {
  const { mode } = useMode()
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [activeShape, setActiveShape] = useState(null)
  const [availableShapes, setAvailableShapes] = useState([])
  const inputRef = useRef(null)

  const submit = async () => {
    const q = input.trim()
    if (!q || loading) return
    setLoading(true)

    try {
      const endpoint = mode === 'vault' ? `/api/vault/search?q=${encodeURIComponent(q)}` : `/api/anvil/search?q=${encodeURIComponent(q)}`
      const res = await fetch(endpoint)
      const raw = await res.json()
      const contract = normalizeResponse(raw, q, mode)

      const shapes = registry.getPrimitivesForShape(contract.shape).map(p => p.id)
      const best = registry.selectPrimitive(contract.shape)

      setAvailableShapes(shapes)
      setActiveShape(best?.id ?? null)
      setHistory(h => [{ role: 'user', text: q }, { role: 'horus', text: `${contract.count} result${contract.count !== 1 ? 's' : ''}`, contract }, ...h])
      onResults?.(contract, best?.id)
    } catch (err) {
      setHistory(h => [{ role: 'user', text: q }, { role: 'horus', text: `Error: ${err.message}`, error: true }, ...h])
    } finally {
      setLoading(false)
      setInput('')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* History panel */}
      {history.length > 0 && (
        <div style={{
          maxHeight: historyOpen ? '140px' : '0px', overflow: 'hidden',
          transition: 'max-height 0.2s ease', borderBottom: historyOpen ? '1px solid var(--border)' : 'none',
        }}>
          <div style={{ maxHeight: '140px', overflowY: 'auto', padding: '6px 12px' }}>
            {history.map((msg, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', padding: '3px 0', fontSize: '12px' }}>
                <span style={{ color: msg.role === 'user' ? 'var(--accent)' : 'var(--status-green)', flexShrink: 0, fontWeight: 600 }}>
                  {msg.role === 'user' ? 'you' : 'horus'}
                </span>
                <span style={{ color: msg.error ? 'var(--status-red)' : 'var(--text-secondary)' }}>{msg.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Primitive selector */}
      {availableShapes.length > 1 && (
        <div style={{ borderBottom: '1px solid var(--border)' }}>
          <PrimitiveSelector shapes={availableShapes} active={activeShape} onChange={id => {
            setActiveShape(id)
            const last = history.find(m => m.contract)
            if (last?.contract) onResults?.(last.contract, id)
          }} />
        </div>
      )}

      {/* Input row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px' }}>
        {history.length > 0 && (
          <button onClick={() => setHistoryOpen(o => !o)} style={{
            background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '14px', padding: '2px 4px',
          }} title="Toggle history">
            {historyOpen ? '▾' : '▸'}
          </button>
        )}
        <span style={{ color: 'var(--text-muted)', fontSize: '14px', flexShrink: 0 }}>⌘</span>
        <input
          ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder={loading ? 'Searching…' : PLACEHOLDERS[mode] ?? 'Search…'}
          disabled={loading}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--text-primary)', fontSize: '14px',
          }}
        />
        {input.trim() && !loading && (
          <button onClick={submit} style={{
            background: 'var(--accent)', border: 'none', borderRadius: '5px',
            color: 'white', cursor: 'pointer', fontSize: '12px', padding: '4px 10px',
          }}>Search</button>
        )}
        {loading && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>…</span>}
      </div>
    </div>
  )
}
