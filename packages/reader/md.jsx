// Markdown renderer + wiki-link parser + shared components
const { useState, useEffect, useMemo, useRef, useCallback } = React;

// ── Mermaid diagram block ────────────────────────────────────────
let _mermaidCounter = 0;
function MermaidBlock({ source }) {
  const containerRef = useRef(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !window.mermaid) return;
    const id = `mermaid-${++_mermaidCounter}`;
    window.mermaid.render(id, source).then(({ svg }) => {
      if (containerRef.current) containerRef.current.innerHTML = svg;
    }).catch(() => {
      setError(true);
    });
  }, [source]);

  if (error) {
    return (
      <div className="mermaid-block mermaid-error">
        <span className="mermaid-error-label">diagram error</span>
        <pre><code data-lang="mermaid">{source}</code></pre>
      </div>
    );
  }

  return <div className="mermaid-block" ref={containerRef} />;
}

// ── Tiny markdown renderer ───────────────────────────────────────
// Supports: headings, paragraphs, lists, code blocks, inline code,
// tables, blockquotes, hr, bold/italic, wiki-links [[...]].
// Pass an optional resolveTitle(text) -> note|null for custom resolution.
function MermaidBlock({ source }) {
  const ref = React.useRef(null);
  const idRef = React.useRef('mermaid-' + Math.random().toString(36).slice(2));
  React.useEffect(() => {
    if (!window.mermaid || !ref.current) return;
    window.mermaid.render(idRef.current, source)
      .then(({ svg }) => { if (ref.current) ref.current.innerHTML = svg; })
      .catch(() => { if (ref.current) ref.current.textContent = source; });
  }, [source]);
  return React.createElement('div', { className: 'mermaid-block', ref });
}

function renderMarkdown(src, onWikiClick, resolveTitle) {
  const _resolve = resolveTitle || ((t) => window.HORUS_DATA.findFuzzy(t));
  const lines = src.split('\n');
  const out = [];
  let i = 0;
  let key = 0;
  const k = () => `md-${key++}`;

  function inline(text) {
    // Handle wiki-links and basic formatting; return array of nodes
    const parts = [];
    let last = 0;
    const re = /\[\[([^\]]+)\]\]|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      if (m[1] !== undefined) {
        const note = _resolve(m[1]);
        parts.push(
          <span
            key={k()}
            className={`wiki-link${note ? '' : ' broken'}`}
            onClick={(e) => {
              e.stopPropagation();
              if (note && onWikiClick) onWikiClick(note.id);
            }}
            title={note ? `Open ${note.title}` : 'Unresolved link'}
          >
            {m[1]}
          </span>
        );
      } else if (m[2] !== undefined) {
        parts.push(<code key={k()}>{m[2]}</code>);
      } else if (m[3] !== undefined) {
        parts.push(<strong key={k()}>{m[3]}</strong>);
      } else if (m[4] !== undefined) {
        parts.push(<em key={k()}>{m[4]}</em>);
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  }

  while (i < lines.length) {
    const line = lines[i];

    // Code fence
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i]); i++;
      }
      i++;
      if (lang === 'mermaid') {
        out.push(<MermaidBlock key={k()} source={buf.join('\n')} />);
      } else {
        out.push(
          <pre key={k()}><code data-lang={lang}>{buf.join('\n')}</code></pre>
        );
      }
      continue;
    }

    // Heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = h[1].length;
      const Tag = `h${Math.min(lvl, 3)}`;
      out.push(React.createElement(Tag, { key: k() }, inline(h[2])));
      i++; continue;
    }

    // HR
    if (/^---+$/.test(line.trim())) {
      out.push(<hr key={k()} />); i++; continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        buf.push(lines[i].slice(2)); i++;
      }
      out.push(<blockquote key={k()}>{inline(buf.join(' '))}</blockquote>);
      continue;
    }

    // Table (very loose)
    if (/^\s*\|.+\|\s*$/.test(line) && /^\s*\|.+\|\s*$/.test(lines[i + 1] || '') && /-{3,}/.test(lines[i + 1] || '')) {
      const headerCells = line.trim().slice(1, -1).split('|').map(s => s.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
        rows.push(lines[i].trim().slice(1, -1).split('|').map(s => s.trim()));
        i++;
      }
      out.push(
        <table key={k()}>
          <thead><tr>{headerCells.map((c, idx) => <th key={idx}>{inline(c)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c)}</td>)}</tr>)}</tbody>
        </table>
      );
      continue;
    }

    // Lists (unordered/ordered/task)
    const ul = /^(\s*)([-*])\s+(.*)$/.exec(line);
    const ol = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
    if (ul || ol) {
      const ordered = !!ol;
      const items = [];
      while (i < lines.length) {
        const ln = lines[i];
        const m1 = ordered ? /^(\s*)(\d+)\.\s+(.*)$/.exec(ln) : /^(\s*)([-*])\s+(.*)$/.exec(ln);
        if (!m1) break;
        let txt = m1[3];
        const taskM = /^\[([ xX])\]\s+(.*)$/.exec(txt);
        if (taskM) {
          items.push(
            <li key={k()} className="task-item">
              <span className={`checkbox${taskM[1].toLowerCase() === 'x' ? ' checked' : ''}`} style={{ display:'inline-block', verticalAlign:'middle', marginRight: 6, width:14, height:14, borderWidth:1.5 }}></span>
              {inline(taskM[2])}
            </li>
          );
        } else {
          items.push(<li key={k()}>{inline(txt)}</li>);
        }
        i++;
      }
      out.push(ordered
        ? <ol key={k()}>{items}</ol>
        : <ul key={k()}>{items}</ul>);
      continue;
    }

    // Blank
    if (!line.trim()) { i++; continue; }

    // Paragraph
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>\s|\s*[-*]\s|\s*\d+\.\s|---+$|\s*\|.+\|)/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push(<p key={k()}>{inline(buf.join(' '))}</p>);
  }

  return out;
}

// ── Type pill ────────────────────────────────────────────────────
function TypePill({ type }) {
  return (
    <span className="type-pill">
      <span className={`dot type-dot ${type}`} />
      {type}
    </span>
  );
}

// ── Status / priority chip helpers ──────────────────────────────
function StatusChip({ status }) {
  if (!status) return null;
  const cls = `chip status-${status.replace(/\s+/g, '-')}`;
  return <span className={cls}>{status}</span>;
}
function PriorityChip({ priority }) {
  if (!priority) return null;
  const short = priority.replace(/-.*$/, ''); // P1, P2, P3
  return <span className="chip priority">{short}</span>;
}

// ── Edge intent → human label ────────────────────────────────────
const EDGE_LABEL = {
  parent_of:   { out: 'has child',    in: 'parent of (this)' },
  belongs_to:  { out: 'belongs to',   in: 'parent (contains this)' },
  blocks:      { out: 'blocks',       in: 'blocked by' },
  references:  { out: 'references',   in: 'referenced by' },
  mentions:    { out: 'mentions',     in: 'mentioned by' },
};
function edgeLabel(intent, dir) {
  return (EDGE_LABEL[intent] && EDGE_LABEL[intent][dir]) || intent;
}

// ── Format date ────────────────────────────────────────────────
function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtRelative(s) {
  if (!s) return '';
  const d = new Date(s);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today - d) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 7) return `${diff}d ago`;
  if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── MarkdownBody ─────────────────────────────────────────────────
// React component wrapping renderMarkdown with async wiki-link resolution.
// For notes loaded from Anvil, most titles resolve sync via HORUS_DATA.findFuzzy.
// Any remaining unresolved titles are batch-searched against Anvil and resolved
// in a second render pass ("placeholder → resolved" behaviour).
function MarkdownBody({ body, onNavigate }) {
  const [asyncResolved, setAsyncResolved] = useState({});

  // Collect wiki-link titles that don't resolve synchronously
  const unresolvedTitles = useMemo(() => {
    if (!body) return [];
    const re = /\[\[([^\]]+)\]\]/g;
    const titles = new Set();
    let m;
    while ((m = re.exec(body)) !== null) {
      if (!window.HORUS_DATA.findFuzzy(m[1])) titles.add(m[1]);
    }
    return [...titles];
  }, [body]);

  // Batch-search Anvil for unresolved titles
  useEffect(() => {
    if (!unresolvedTitles.length || !window.AnvilClient) return;
    const pending = unresolvedTitles.filter(t => !(t in asyncResolved));
    if (!pending.length) return;

    Promise.all(
      pending.map(async (title) => {
        try {
          const result = await window.AnvilClient.search({ query: title, limit: 1 });
          const hit = result?.results?.[0];
          // Only accept if title matches closely (avoid false positives)
          if (hit && hit.title.toLowerCase().includes(title.toLowerCase())) {
            return [title, { id: hit.id, title: hit.title, type: hit.type }];
          }
        } catch {}
        return [title, null];
      })
    ).then((entries) => {
      setAsyncResolved((prev) => {
        const next = { ...prev };
        entries.forEach(([t, note]) => { next[t] = note; });
        return next;
      });
    });
  }, [unresolvedTitles]);

  function resolveTitle(title) {
    return window.HORUS_DATA.findFuzzy(title) || asyncResolved[title] || null;
  }

  if (!body) return null;
  return <>{renderMarkdown(body, onNavigate, resolveTitle)}</>;
}

// expose
window.MD = { renderMarkdown, MarkdownBody, TypePill, StatusChip, PriorityChip, edgeLabel, fmtDate, fmtRelative };
