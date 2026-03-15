import { useParams } from 'react-router-dom'
export function PageView() {
  const { id } = useParams()
  return <div style={{ color: 'var(--text-secondary)' }}>Page viewer for {id} — coming in WI-17.</div>
}
