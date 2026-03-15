import { useParams } from 'react-router-dom'
export function NoteView() {
  const { id } = useParams()
  return <div style={{ color: 'var(--text-secondary)' }}>Note viewer for {id} — coming in WI-17.</div>
}
