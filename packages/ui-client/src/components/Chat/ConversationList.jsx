/**
 * ConversationList — sidebar component showing recent conversations.
 */
import { useState, useEffect, useCallback } from 'react'

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

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations')
      const data = await res.json()
      setConversations(data.conversations ?? [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load() }, [load, refreshTrigger])

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <button onClick={onNew} style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        margin: '8px 6px', padding: '7px 10px',
        background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
        borderRadius: '6px', color: 'var(--text-secondary)',
        cursor: 'pointer', fontSize: '12px',
      }}>
        <span>+</span> New chat
      </button>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {conversations.map(conv => (
          <button key={conv.id} onClick={() => onSelect(conv.id)} style={{
            display: 'flex', flexDirection: 'column', gap: '2px',
            width: '100%', textAlign: 'left', cursor: 'pointer',
            padding: '6px 12px', margin: '1px 0',
            background: conv.id === activeId ? 'var(--bg-tertiary)' : 'transparent',
            border: 'none', borderRadius: '4px',
            color: 'var(--text-primary)',
          }}>
            <span style={{
              fontSize: '12px', fontWeight: conv.id === activeId ? 600 : 400,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              maxWidth: '180px',
            }}>
              {conv.title || 'New conversation'}
            </span>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              {timeAgo(conv.modified)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
