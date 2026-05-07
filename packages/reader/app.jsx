// Main App — routing, history stack, recents, keyboard, tweaks
const { useState: uS, useEffect: uE, useMemo: uM, useRef: uR } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "density": "cozy",
  "showFrontmatter": true,
  "accent": "amber"
}/*EDITMODE-END*/;

const ACCENTS = {
  amber:  { dark: 'oklch(0.74 0.13 60)',   light: 'oklch(0.55 0.16 50)' },
  rose:   { dark: 'oklch(0.74 0.14 15)',   light: 'oklch(0.55 0.18 15)' },
  sage:   { dark: 'oklch(0.74 0.10 145)',  light: 'oklch(0.50 0.12 145)' },
  indigo: { dark: 'oklch(0.72 0.14 270)',  light: 'oklch(0.50 0.16 270)' },
};

const TWEAKS_KEY = 'horus:tweaks';

function routeKey(r) {
  if (!r) return '';
  if (r.kind === 'home') return 'home';
  if (r.kind === 'note') return `n:${r.id}`;
  if (r.kind === 'tag') return `t:${r.tag}`;
  if (r.kind === 'type') return `y:${r.type}`;
  if (r.kind === 'ask') return 'ask';
  return JSON.stringify(r);
}

function App() {
  // History stack: array of routes; cursor = current index
  const [history, setHistory] = uS([{ kind: 'home' }]);
  const [cursor, setCursor] = uS(0);
  const route = history[cursor];

  const data = window.HORUS_DATA;

  // Initialize mermaid once on mount
  uE(() => {
    window.mermaid?.initialize({
      startOnLoad: false,
      theme: 'dark',
      darkMode: true,
      themeVariables: {
        background: '#14141c',
        primaryColor: '#d4900a',
      }
    });
  }, []);

  // Increment to trigger re-render after Anvil data loads
  const [dataVersion, setDataVersion] = uS(0);
  uE(() => {
    data.onDataChange(() => setDataVersion(v => v + 1));
    data.loadFromAnvil().then(result => {
      if (result.ok) {
        setBootstrapError(false);
        data.connectSSE();
      } else {
        setBootstrapError(true);
      }
    });
    return () => data.disconnectSSE();
  }, []);

  function handleRetry() {
    data.loadFromAnvil().then(result => {
      if (result.ok) {
        setBootstrapError(false);
        data.connectSSE();
      }
    });
  }
  const lastSyncedAt = uM(() => data.getLastSyncedAt(), [dataVersion]);

  const PIN_KEY = 'horus:pinned';
  const PIN_DEFAULTS = ['proj-horus-ui', 'story-linked-refs', 'note-edge-taxonomy', 'journal-2026-04-29'];
  const [recents, setRecents] = uS(() => JSON.parse(localStorage.getItem('horus:recents') || '[]'));
  const [pinned, setPinned] = uS(() => {
    try {
      const v = localStorage.getItem(PIN_KEY);
      return v === null ? [...PIN_DEFAULTS] : (JSON.parse(v) || []);
    } catch { return [...PIN_DEFAULTS]; }
  });
  const [paletteOpen, setPaletteOpen] = uS(false);
  // Restore theme/accent/density from localStorage on mount
  const [tweaks, setTweaksState] = uS(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(TWEAKS_KEY) || '{}');
      return { ...TWEAK_DEFAULTS, ...saved };
    } catch { return TWEAK_DEFAULTS; }
  });
  const [sideCollapsed, setSideCollapsed] = uS(() => localStorage.getItem('horus:side-collapsed') === '1');
  const [refsCollapsed, setRefsCollapsed] = uS(() => localStorage.getItem('horus:refs-collapsed') === '1');
  const [bootstrapError, setBootstrapError] = uS(false);
  const typeCounts = uM(() => data.typeCounts(), [dataVersion]);

  function togglePin(id) {
    setPinned(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [id, ...prev];
      try { localStorage.setItem(PIN_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function setTweak(k, v) {
    setTweaksState(prev => {
      const next = typeof k === 'object' ? { ...prev, ...k } : { ...prev, [k]: v };
      try {
        localStorage.setItem(TWEAKS_KEY, JSON.stringify(next));
        window.parent?.postMessage({ type: '__edit_mode_set_keys', edits: typeof k === 'object' ? k : { [k]: v } }, '*');
      } catch {}
      return next;
    });
  }

  uE(() => {
    document.documentElement.setAttribute('data-theme', tweaks.theme);
    document.documentElement.setAttribute('data-density', tweaks.density);
    const a = ACCENTS[tweaks.accent] || ACCENTS.amber;
    const val = a[tweaks.theme === 'light' ? 'light' : 'dark'];
    document.documentElement.style.setProperty('--accent', val);
    document.documentElement.style.setProperty('--link', val);
  }, [tweaks]);



  function navigate(r) {
    // Don't push duplicate of current
    if (routeKey(r) === routeKey(route)) return;
    setHistory(prev => {
      const trimmed = prev.slice(0, cursor + 1);
      return [...trimmed, r];
    });
    setCursor(c => c + 1);
    if (r.kind === 'note') {
      setRecents(prev => {
        const next = [r.id, ...prev.filter(x => x !== r.id)].slice(0, 12);
        localStorage.setItem('horus:recents', JSON.stringify(next));
        return next;
      });
    }
    // Track last editor path for mode toggle
    if (r.kind !== 'ask') {
      const editorPath = r.kind === 'home' ? '/' : r.kind === 'note' ? `/n/${r.id}` : r.kind === 'tag' ? `/t/${r.tag}` : r.kind === 'type' ? `/type/${r.type}` : '/';
      window.ChatSessionStore?.setLastEditorPath(editorPath);
    }
    document.querySelector('.main')?.scrollTo({ top: 0 });
  }

  function goBack() { if (cursor > 0) { setCursor(c => c - 1); document.querySelector('.main')?.scrollTo({ top: 0 }); } }
  function goForward() { if (cursor < history.length - 1) { setCursor(c => c + 1); document.querySelector('.main')?.scrollTo({ top: 0 }); } }
  const canBack = cursor > 0;
  const canFwd = cursor < history.length - 1;

  function toggleSide() {
    setSideCollapsed(c => { const n = !c; localStorage.setItem('horus:side-collapsed', n ? '1' : '0'); return n; });
  }

  // Persist refsCollapsed
  uE(() => { localStorage.setItem('horus:refs-collapsed', refsCollapsed ? '1' : '0'); }, [refsCollapsed]);

  // Keyboard shortcuts
  uE(() => {
    function onKey(e) {
      const inField = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setPaletteOpen(true); }
      else if (!inField && e.key === '/') { e.preventDefault(); setPaletteOpen(true); }
      else if (!inField && e.key === '[') { e.preventDefault(); goBack(); }
      else if (!inField && e.key === ']') { e.preventDefault(); goForward(); }
      else if ((e.metaKey || e.altKey) && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
      else if ((e.metaKey || e.altKey) && e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
      else if (!inField && e.key === 'g') {
        const handler = (ev) => {
          if (ev.key === 'h') { ev.preventDefault(); navigate({ kind: 'home' }); }
          document.removeEventListener('keydown', handler, true);
        };
        document.addEventListener('keydown', handler, true);
        setTimeout(() => document.removeEventListener('keydown', handler, true), 800);
      }
    }
    function onMouse(e) {
      if (e.button === 3) { e.preventDefault(); goBack(); }
      else if (e.button === 4) { e.preventDefault(); goForward(); }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onMouse);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onMouse);
    };
  }, [cursor, history.length]);

  const TweaksPanel = window.TweaksPanel;
  const TweakSection = window.TweakSection;
  const TweakRadio = window.TweakRadio;
  const TweakToggle = window.TweakToggle;

  let pageEl = null;
  if (route.kind === 'home') pageEl = <HomePage onNavigate={navigate} />;
  else if (route.kind === 'note') pageEl = <NotePage noteId={route.id} onNavigate={navigate} refsCollapsed={refsCollapsed} setRefsCollapsed={setRefsCollapsed} pinned={pinned} togglePin={togglePin} />;
  else if (route.kind === 'tag') pageEl = <TagPage tag={route.tag} onNavigate={navigate} />;
  else if (route.kind === 'type') pageEl = <TypePage type={route.type} onNavigate={navigate} />;
  else if (route.kind === 'ask') pageEl = <window.AskPage onNavigate={navigate} />;

  const crumb = route.kind === 'home' ? '/' :
    route.kind === 'ask' ? '/ask' :
    route.kind === 'note' ? `/n/${route.id}` :
    route.kind === 'tag' ? `/t/${route.tag}` :
    route.kind === 'type' ? `/type/${route.type}` : '/';

  return (
    <div className={`app${sideCollapsed ? ' side-collapsed' : ''}${route.kind === 'ask' ? ' ask-mode' : ''}`}>
      <header className="head">
        <button className="icon-btn" title="Toggle sidebar" onClick={toggleSide}>
          <window.Icon.Sidebar />
        </button>

        <div className="nav-arrows">
          <button className="icon-btn" title="Back ([)" onClick={goBack} disabled={!canBack}><window.Icon.ArrowLeft /></button>
          <button className="icon-btn" title="Forward (])" onClick={goForward} disabled={!canFwd}><window.Icon.ArrowRight /></button>
        </div>

        <div className="brand" onClick={() => navigate({ kind: 'home' })}>
          <span className="logo"></span>
          <h1>Horus Reader</h1>
          <span className="crumb">{crumb}</span>
        </div>

        {window.ModeToggle && <window.ModeToggle route={route} onNavigate={navigate} />}

        <div className="head-search">
          <button className="head-search-btn" onClick={() => setPaletteOpen(true)}>
            <span className="ico"><window.Icon.Search /></span>
            <span className="grow">Search Horus…</span>
            <span className="kbd">⌘K</span>
          </button>
        </div>
        <div className="head-actions">
          <button className="icon-btn" title="Toggle theme" onClick={() => setTweak('theme', tweaks.theme === 'dark' ? 'light' : 'dark')}>
            {tweaks.theme === 'dark' ? <window.Icon.Moon /> : <window.Icon.Sun />}
          </button>
          {route.kind === 'note' && (
            <button className={`icon-btn${!refsCollapsed ? ' active' : ''}`} title="Toggle context rail" onClick={() => setRefsCollapsed(c => !c)}>
              <window.Icon.PanelRight />
            </button>
          )}
        </div>
      </header>

      {route.kind !== 'ask' && <Sidebar recents={recents} currentRoute={route} onNavigate={navigate} typeCounts={typeCounts} collapsed={sideCollapsed} pinned={pinned} togglePin={togglePin} lastSyncedAt={lastSyncedAt} onRefresh={() => data.manualRefresh()} />}

      <main className="main">
        {bootstrapError && (
          <div style={{ padding: '10px 16px', background: 'oklch(0.22 0.04 60)', borderBottom: '1px solid oklch(0.35 0.08 60)', color: 'oklch(0.85 0.10 60)', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', lineHeight: '1.4' }}>
            <span>⚠ Could not load notes from Anvil. Showing cached/demo data.</span>
            <button onClick={handleRetry} style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: '4px', border: '1px solid oklch(0.45 0.10 60)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '12px' }}>Retry</button>
          </div>
        )}
        {route.kind === 'note' && window.__chatReturnContext && (
          <button className="from-chat-badge" onClick={() => {
            const ctx = window.__chatReturnContext;
            window.__chatReturnContext = null;
            navigate({ kind: 'ask', sessionId: ctx.sessionId });
          }}>← from chat</button>
        )}
        {pageEl}
      </main>

      {paletteOpen && (
        <SearchPalette onClose={() => setPaletteOpen(false)} onNavigate={navigate} />
      )}

      {TweaksPanel && (
        <TweaksPanel title="Tweaks" defaultPosition={{ right: 16, bottom: 16 }}>
          <TweakSection title="Theme">
            <TweakRadio value={tweaks.theme} onChange={v => setTweak('theme', v)}
              options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
          </TweakSection>
          <TweakSection title="Density">
            <TweakRadio value={tweaks.density} onChange={v => setTweak('density', v)}
              options={[{ value: 'cozy', label: 'Cozy' }, { value: 'compact', label: 'Compact' }]} />
          </TweakSection>
          <TweakSection title="Accent">
            <TweakRadio value={tweaks.accent} onChange={v => setTweak('accent', v)}
              options={[
                { value: 'amber', label: 'Amber' }, { value: 'rose', label: 'Rose' },
                { value: 'sage', label: 'Sage' }, { value: 'indigo', label: 'Indigo' },
              ]} />
          </TweakSection>
          <TweakSection title="Layout">
            <TweakToggle label="Collapse sidebar" value={sideCollapsed} onChange={v => setSideCollapsed(v)} />
            <TweakToggle label="Collapse note context rail" value={refsCollapsed} onChange={v => setRefsCollapsed(v)} />
          </TweakSection>
        </TweaksPanel>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
