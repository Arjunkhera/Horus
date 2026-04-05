import { useParams, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { MarkdownRenderer } from '../components/MarkdownRenderer'

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {[200, 140, 180, 100].map((w, i) => (
        <div key={i} style={{ height: '14px', width: `${w}px`, background: 'var(--bg-tertiary)', borderRadius: '4px', animation: 'pulse 1.5s infinite' }} />
      ))}
    </div>
  )
}

const STATUS_COLOR = { open: 'var(--status-green)', 'in-progress': 'var(--accent)', done: 'var(--text-muted)', blocked: 'var(--status-red)' }

function MetaBlock({ note }) {
  const fields = note.fields ?? {}
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '20px', fontSize: '12px' }}>
      {note.type && <span style={{ padding: '2px 8px', borderRadius: '10px', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>{note.type}</span>}
      {note.status && <span style={{ padding: '2px 8px', borderRadius: '10px', background: `${STATUS_COLOR[note.status] ?? 'var(--text-muted)'}22`, color: STATUS_COLOR[note.status] ?? 'var(--text-muted)' }}>{note.status}</span>}
      {note.priority && <span style={{ padding: '2px 8px', borderRadius: '10px', background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>{note.priority}</span>}
      {(note.tags ?? []).map(t => <span key={t} style={{ padding: '2px 8px', borderRadius: '10px', background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>{t}</span>)}
      {note.modified && <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>modified {new Date(note.modified).toLocaleDateString()}</span>}
    </div>
  )
}

export function NoteView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [note, setNote] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = () => {
    setLoading(true); setError(null)
    fetch(`/api/anvil/notes/${id}`)
      .then(r => { if (r.status === 404) throw new Error('404'); return r.json() })
      .then(data => { setNote(data); setLoading(false) })
      .catch(err => { setError(err.message === '404' ? 'not_found' : 'error'); setLoading(false) })
  }

  useEffect(() => { load() }, [id])

  if (loading) return <div style={{ padding: '24px' }}><Skeleton /></div>

  if (error === 'not_found') return (
    <div style={{ textAlign: 'center', marginTop: '60px' }}>
      <p style={{ color: 'var(--text-muted)', marginBottom: '12px' }}>Note not found</p>
      <button onClick={() => navigate(-1)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-secondary)', cursor: 'pointer', padding: '6px 14px' }}>← Back</button>
    </div>
  )

  if (error) return (
    <div style={{ textAlign: 'center', marginTop: '60px' }}>
      <p style={{ color: 'var(--status-red)', marginBottom: '12px' }}>Failed to load note</p>
      <button onClick={load} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-secondary)', cursor: 'pointer', padding: '6px 14px' }}>Retry</button>
    </div>
  )

  return (
    <div style={{ maxWidth: '760px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>{note.title}</h1>
      <MetaBlock note={note} />
      <MarkdownRenderer content={note.body ?? ''} />
    </div>
  )
}
