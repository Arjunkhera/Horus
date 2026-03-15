import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'

function FrontmatterBlock({ data }) {
  if (!data || !Object.keys(data).length) return null
  return (
    <div style={{
      background: 'var(--bg-tertiary)',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      padding: '8px 12px',
      marginBottom: '16px',
      fontSize: '12px',
      color: 'var(--text-secondary)',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px',
    }}>
      {Object.entries(data).map(([k, v]) => (
        <span key={k}>
          <span style={{ color: 'var(--text-muted)' }}>{k}:</span>{' '}
          <span style={{ color: 'var(--text-primary)' }}>{String(v)}</span>
        </span>
      ))}
    </div>
  )
}

function slug(children) {
  return String(children).toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
}

const components = {
  h1: ({ children }) => <h1 id={slug(children)} style={{ fontSize: '1.6em', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px solid var(--border)' }}><a href={`#${slug(children)}`} style={{ color: 'inherit', textDecoration: 'none' }}>{children}</a></h1>,
  h2: ({ children }) => <h2 id={slug(children)} style={{ fontSize: '1.3em', marginTop: '20px', marginBottom: '8px' }}><a href={`#${slug(children)}`} style={{ color: 'inherit', textDecoration: 'none' }}>{children}</a></h2>,
  h3: ({ children }) => <h3 id={slug(children)} style={{ fontSize: '1.1em', marginTop: '16px', marginBottom: '6px', color: 'var(--text-secondary)' }}>{children}</h3>,
  h4: ({ children }) => <h4 style={{ fontSize: '1em', marginTop: '12px', marginBottom: '4px', color: 'var(--text-secondary)' }}>{children}</h4>,
  h5: ({ children }) => <h5 style={{ fontSize: '0.9em', marginTop: '10px', marginBottom: '4px', color: 'var(--text-muted)' }}>{children}</h5>,
  h6: ({ children }) => <h6 style={{ fontSize: '0.85em', marginTop: '8px', marginBottom: '4px', color: 'var(--text-muted)' }}>{children}</h6>,
  code: ({ inline, className, children, ...p }) => inline
    ? <code style={{ background: 'var(--bg-tertiary)', padding: '1px 5px', borderRadius: '3px', fontSize: '0.88em', color: 'var(--accent)' }} {...p}>{children}</code>
    : <code className={className} {...p}>{children}</code>,
  blockquote: ({ children }) => (
    <blockquote style={{ borderLeft: '3px solid var(--border)', paddingLeft: '12px', color: 'var(--text-secondary)', margin: '12px 0' }}>{children}</blockquote>
  ),
  a: ({ href, children }) => (
    <a href={href} style={{ color: 'var(--accent)' }}>{children}</a>
  ),
  input: ({ type, checked }) => type === 'checkbox'
    ? <input type="checkbox" checked={checked} readOnly style={{ marginRight: '4px', accentColor: 'var(--accent)' }} />
    : null,
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />,
  table: ({ children }) => <div style={{ overflowX: 'auto', margin: '12px 0' }}><table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13px' }}>{children}</table></div>,
  th: ({ children }) => <th style={{ padding: '6px 12px', borderBottom: '2px solid var(--border)', textAlign: 'left', color: 'var(--text-secondary)' }}>{children}</th>,
  td: ({ children }) => <td style={{ padding: '6px 12px', borderBottom: '1px solid var(--border-subtle)' }}>{children}</td>,
  pre: ({ children }) => <pre style={{ background: 'var(--bg-secondary)', borderRadius: '6px', padding: '12px', overflowX: 'auto', fontSize: '13px', margin: '12px 0', border: '1px solid var(--border)' }}>{children}</pre>,
  p: ({ children }) => <p style={{ lineHeight: 1.6, marginBottom: '8px' }}>{children}</p>,
  ul: ({ children }) => <ul style={{ paddingLeft: '20px', marginBottom: '8px', lineHeight: 1.7 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ paddingLeft: '20px', marginBottom: '8px', lineHeight: 1.7 }}>{children}</ol>,
}

export function MarkdownRenderer({ content = '', frontmatter = null }) {
  if (!content && !frontmatter) {
    return <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No content</div>
  }
  return (
    <div style={{ color: 'var(--text-primary)' }}>
      {frontmatter && <FrontmatterBlock data={frontmatter} />}
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkFrontmatter]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
