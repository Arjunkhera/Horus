/**
 * ConversationList — sidebar component showing recent conversations.
 */
import { useState, useEffect, useCallback, useRef } from 'react'

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

export function ConversationList({ activeId, onSelect, onNew, refreshTrigger }) {
  const [conversations, setConversations] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const isEscaping = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations')
      const data = await res.json()
      setConversations(data.conversations ?? [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load() }, [load, refreshTrigger])

  const handleDoubleClick = useCallback((e, conv) => {
    e.stopPropagation()
    isEscaping.current = false
    setEditingId(conv.id)
    setEditValue(conv.title || 'New conversation')
  }, [])

  const saveRename = useCallback(async (id, newTitle, oldTitle) => {
    const trimmed = newTitle.trim()
    if (!trimmed) return // reject empty — keep old
    if (trimmed === oldTitle) { setEditingId(null); return }
    // Optimistic update
    setConversations(prev => prev.map(c => c.id === id ? { ...c, title: trimmed } : c))
    setEditingId(null)
    try {
      const res = await fetch(`/api/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      })
      if (!res.ok) throw new Error('patch failed')
    } catch {
      // Rollback
      setConversations(prev => prev.map(c => c.id === id ? { ...c, title: oldTitle } : c))
    }
  }, [])

  const handleRenameKeyDown = useCallback((e, conv) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveRename(conv.id, editValue, conv.title || 'New conversation')
    } else if (e.key === 'Escape') {
      isEscaping.current = true
      setEditingId(null)
      setEditValue('')
    }
  }, [editValue, saveRename])

  const handleRenameBlur = useCallback((conv) => {
    if (isEscaping.current) {
      isEscaping.current = false
      return
    }
    saveRename(conv.id, editValue, conv.title || 'New conversation')
  }, [editValue, saveRename])

  return (
    <div>
      <button onClick={onNew} style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        margin: '8px 6px', padding: '7px 10px',
        background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
        borderRadius: '6px', color: 'var(--text-secondary)',
        cursor: 'pointer', fontSize: '12px',
      }}>
        <span>+</span> New chat
      </button>

      {conversations.map(conv => (
        <button
          key={conv.id}
          onClick={() => onSelect(conv.id)}
          onDoubleClick={(e) => handleDoubleClick(e, conv)}
          style={{
            display: 'flex', flexDirection: 'column', gap: '2px',
            width: '100%', textAlign: 'left', cursor: 'pointer',
            padding: '6px 12px', margin: '1px 0',
            background: conv.id === activeId ? 'var(--bg-tertiary)' : 'transparent',
            border: 'none', borderRadius: '4px',
            color: 'var(--text-primary)',
          }}
        >
          {editingId === conv.id ? (
            <input
              autoFocus
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={e => handleRenameKeyDown(e, conv)}
              onBlur={() => handleRenameBlur(conv)}
              onClick={e => e.stopPropagation()}
              style={{
                fontSize: '12px', fontWeight: 600,
                width: '100%', maxWidth: '180px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--accent)',
                borderRadius: '3px',
                color: 'var(--text-primary)',
                padding: '1px 4px',
                outline: 'none',
              }}
            />
          ) : (
            <span style={{
              fontSize: '12px', fontWeight: conv.id === activeId ? 600 : 400,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              maxWidth: '180px',
            }}>
              {conv.title || 'New conversation'}
            </span>
          )}
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {timeAgo(conv.modified)}
          </span>
        </button>
      ))}
    </div>
  )
}
