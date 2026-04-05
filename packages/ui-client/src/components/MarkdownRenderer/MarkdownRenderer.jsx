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

/** Replace [[wiki-links]] with a styled span before rendering */
function preprocessWikiLinks(content) {
  return content.replace(/\[\[([^\]]+)\]\]/g, (_match, title) => {
    const [label, alias] = title.split('|')
    return `<span class="wiki-link" title="Wiki link: ${label}">${alias ?? label}</span>`
  })
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
    <blockquote style={{
      borderLeft: '3px solid var(--accent)',
      paddingLeft: '12px',
      color: 'var(--text-secondary)',
      margin: '12px 0',
      background: 'var(--bg-secondary)',
      borderRadius: '0 4px 4px 0',
      padding: '8px 12px',
    }}>{children}</blockquote>
  ),
  a: ({ href, children }) => (
    <a href={href} style={{ color: 'var(--accent)' }} target={href?.startsWith('http') ? '_blank' : undefined} rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}>{children}</a>
  ),
  input: ({ type, checked }) => type === 'checkbox'
    ? <input type="checkbox" checked={checked} readOnly style={{ marginRight: '4px', accentColor: 'var(--accent)', cursor: 'default' }} />
    : null,
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />,
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', margin: '14px 0', borderRadius: '6px', border: '1px solid var(--border)', overflow: 'hidden' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13px' }}>{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead style={{ background: 'var(--bg-tertiary)' }}>{children}</thead>,
  th: ({ children }) => <th style={{ padding: '6px 12px', borderBottom: '2px solid var(--border)', borderRight: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>{children}</th>,
  td: ({ children }) => <td style={{ padding: '6px 12px', borderBottom: '1px solid var(--border-subtle)', borderRight: '1px solid var(--border-subtle)' }}>{children}</td>,
  pre: ({ children }) => {
    // Extract language label from the child <code> element's className
    const childCode = children?.props ?? {}
    const langMatch = (childCode.className ?? '').match(/language-(\w+)/)
    const lang = langMatch ? langMatch[1] : null
    return (
      <div style={{ position: 'relative', margin: '14px 0' }}>
        {lang && (
          <span style={{
            position: 'absolute',
            top: '8px',
            right: '10px',
            fontSize: '10px',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            pointerEvents: 'none',
            userSelect: 'none',
            fontFamily: "'SFMono-Regular', Consolas, monospace",
          }}>
            {lang}
          </span>
        )}
        <pre style={{
          background: 'var(--bg-secondary)',
          borderRadius: '8px',
          padding: lang ? '32px 14px 14px' : '14px',
          overflowX: 'auto',
          fontSize: '13px',
          border: '1px solid var(--border)',
          lineHeight: 1.55,
          fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
        }}>
          {children}
        </pre>
      </div>
    )
  },
  p: ({ children }) => <p style={{ lineHeight: 1.7, marginBottom: '10px' }}>{children}</p>,
  ul: ({ children }) => <ul style={{ paddingLeft: '20px', marginBottom: '8px', lineHeight: 1.7 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ paddingLeft: '20px', marginBottom: '8px', lineHeight: 1.7 }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: '3px', lineHeight: 1.7 }}>{children}</li>,
  strong: ({ children }) => <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{children}</strong>,
  em: ({ children }) => <em style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>{children}</em>,
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt ?? ''}
      style={{ maxWidth: '100%', borderRadius: '6px', margin: '8px 0', border: '1px solid var(--border)' }}
      onError={e => { e.currentTarget.style.display = 'none' }}
    />
  ),
}

export function MarkdownRenderer({ content = '', frontmatter = null }) {
  if (!content && !frontmatter) {
    return <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No content</div>
  }
  const processed = preprocessWikiLinks(content)
  return (
    <div style={{ color: 'var(--text-primary)' }}>
      {frontmatter && <FrontmatterBlock data={frontmatter} />}
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkFrontmatter]}
        rehypePlugins={[[rehypeHighlight, { detect: true }]]}
        components={components}
      >
        {processed}
      </ReactMarkdown>
      <style>{`
        .wiki-link {
          color: var(--accent);
          background: rgba(88, 166, 255, 0.12);
          border-radius: 3px;
          padding: 0 3px;
          font-size: 0.92em;
          cursor: default;
        }
        .hljs { background: transparent !important; }
      `}</style>
    </div>
  )
}
