import { useParams, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { MarkdownRenderer } from '../components/MarkdownRenderer'

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {[200, 140, 180, 100].map((w, i) => (
        <div key={i} style={{ height: '14px', width: `${w}px`, background: 'var(--bg-tertiary)', borderRadius: '4px' }} />
      ))}
    </div>
  )
}

function MetaBlock({ page }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '20px', fontSize: '12px' }}>
      {page.type && <span style={{ padding: '2px 8px', borderRadius: '10px', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>{page.type}</span>}
      {(page.tags ?? []).map(t => <span key={t} style={{ padding: '2px 8px', borderRadius: '10px', background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>{t}</span>)}
      {page.modified && <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>modified {new Date(page.modified).toLocaleDateString()}</span>}
    </div>
  )
}

export function PageView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [page, setPage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = () => {
    setLoading(true); setError(null)
    fetch(`/api/vault/pages/${id}`)
      .then(r => { if (r.status === 404) throw new Error('404'); return r.json() })
      .then(data => { setPage(data); setLoading(false) })
      .catch(err => { setError(err.message === '404' ? 'not_found' : 'error'); setLoading(false) })
  }

  useEffect(() => { load() }, [id])

  if (loading) return <div style={{ padding: '24px' }}><Skeleton /></div>
  if (error === 'not_found') return (
    <div style={{ textAlign: 'center', marginTop: '60px' }}>
      <p style={{ color: 'var(--text-muted)', marginBottom: '12px' }}>Page not found</p>
      <button onClick={() => navigate(-1)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-secondary)', cursor: 'pointer', padding: '6px 14px' }}>← Back</button>
    </div>
  )
  if (error) return (
    <div style={{ textAlign: 'center', marginTop: '60px' }}>
      <p style={{ color: 'var(--status-red)', marginBottom: '12px' }}>Failed to load page</p>
      <button onClick={load} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-secondary)', cursor: 'pointer', padding: '6px 14px' }}>Retry</button>
    </div>
  )

  return (
    <div style={{ maxWidth: '760px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>{page.title}</h1>
      <MetaBlock page={page} />
      <MarkdownRenderer content={page.content ?? page.body ?? ''} frontmatter={page.frontmatter ?? null} />
    </div>
  )
}
