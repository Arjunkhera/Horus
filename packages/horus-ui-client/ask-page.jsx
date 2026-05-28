// AskPage — NLP Agent Search UI (/ask route)
// Contains: AskPage, ChatPane, CitationRenderer, RefList, NotePreviewPane
(function () {
  const { useState: uS, useEffect: uE, useRef: uR, useMemo: uM } = React;
  const store = () => window.ChatSessionStore;

  // ── Type dot colors ────────────────────────────────────────────
  const TYPE_COLORS = {
    note: '#7ab0d0', task: '#6abf83', journal: '#d4a060',
    project: '#b080d0', story: '#d07060', 'conversation-state': '#8090d0', bookmark: '#6080c0',
  };
  function typeDotStyle(type) {
    return { background: TYPE_COLORS[type] || '#888' };
  }

  // ── Age string ─────────────────────────────────────────────────
  function ageStr(isoDate) {
    if (!isoDate) return '';
    const diff = Date.now() - new Date(isoDate).getTime();
    const d = Math.floor(diff / 86400000);
    if (d === 0) return 'today';
    if (d === 1) return '1d';
    if (d < 30) return `${d}d`;
    return `${Math.floor(d / 30)}mo`;
  }

  // ── Citation renderer ──────────────────────────────────────────
  function CitationText({ text, references, onCiteClick, activeRefN }) {
    if (!references || references.length === 0) {
      return <span>{text}</span>;
    }
    // Parse [n] patterns and replace with clickable spans
    const parts = [];
    const regex = /\[(\d+)\]/g;
    let last = 0, m;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      const n = parseInt(m[1]);
      const ref = references.find(r => r.n === n);
      if (ref) {
        parts.push(
          <span key={m.index} className="cite-ref"
            data-ref-n={n}
            onClick={() => onCiteClick(ref)}>
            [{n}]
          </span>
        );
      } else {
        parts.push(m[0]);
      }
      last = regex.lastIndex;
    }
    if (last < text.length) parts.push(text.slice(last));
    return <span>{parts}</span>;
  }

  // ── Reference list ─────────────────────────────────────────────
  function RefList({ references, activeRefN, onRefClick }) {
    const [expanded, setExpanded] = uS(null); // null=auto, true/false=override
    if (!references || references.length === 0) return null;
    const isExpanded = expanded === null ? references.length <= 3 : expanded;

    return (
      <div className="ref-list">
        <div className="ref-list-header" onClick={() => setExpanded(!isExpanded)}>
          <span>{isExpanded ? '▾' : '▸'}</span>
          <span>References · {references.length}</span>
        </div>
        {isExpanded
          ? references.map(ref => (
            <div key={ref.n} className={`ref-item${ref.n === activeRefN ? ' active' : ''}`}
              onClick={() => onRefClick(ref)}>
              <span className="ref-n">[{ref.n}]</span>
              <span className="ref-type-dot" style={typeDotStyle(ref.type)} />
              <span className="ref-title">{window.HORUS_DATA?.byId[ref.noteId]?.title || ref.title}</span>
              <span className="ref-age">{ageStr(window.HORUS_DATA?.byId[ref.noteId]?.modified || ref.modified)}</span>
            </div>
          ))
          : (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
              {references.map(ref => (
                <span key={ref.n} onClick={() => onRefClick(ref)}
                  style={{ padding: '1px 6px', border: '1px solid var(--line-soft)', borderRadius: 99, font: '400 7.5px/1 var(--font-mono)', cursor: 'pointer', color: 'var(--ink-3)' }}>
                  [{ref.n}] {window.HORUS_DATA?.byId[ref.noteId]?.title || ref.title}<span style={{ marginLeft: 3, opacity: 0.5 }}>{ref.type}</span>
                </span>
              ))}
            </div>
          )
        }
      </div>
    );
  }

  // ── Chat Pane ──────────────────────────────────────────────────
  function ChatPane({ sessionId, onOpenPreview, onSessionCreated, pendingQuestion, onPendingSubmitted }) {
    const [session, setSession] = uS(() => sessionId ? store().getSession(sessionId) : null);
    const [streamState, setStreamState] = uS('idle'); // idle | searching | streaming | done
    const [statusText, setStatusText] = uS('');
    const [streamText, setStreamText] = uS('');
    const [inputVal, setInputVal] = uS('');
    const [activeRefN, setActiveRefN] = uS(null);
    const messagesRef = uR(null);
    const autoScrollRef = uR(true);
    const inputRef = uR(null);
    const [elapsedSecs, setElapsedSecs] = uS(0);
    const genStartRef = uR(null);
    const isGenerating = streamState === 'searching' || streamState === 'streaming';

    uE(() => {
      if (sessionId) setSession(store().getSession(sessionId));
      else setSession(null);
    }, [sessionId]);

    // Submit question that was pre-queued from the home ask bar.
    // The session was already created with the user message; skip re-adding it.
    uE(() => {
      if (!pendingQuestion) return;
      onPendingSubmitted?.();
      submitQuestion(pendingQuestion, { alreadyAdded: true });
    }, [pendingQuestion]);

    uE(() => {
      function onResponse(e) {
        if (e.detail.id === sessionId) setSession(store().getSession(sessionId));
      }
      window.addEventListener('chat-session-response', onResponse);
      return () => window.removeEventListener('chat-session-response', onResponse);
    }, [sessionId]);

    // Auto-scroll during streaming
    uE(() => {
      if (streamState === 'streaming' && autoScrollRef.current && messagesRef.current) {
        messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
      }
    }, [streamText, streamState]);

    // Elapsed timer — starts when generation begins, resets on idle
    uE(() => {
      if (streamState === 'idle') {
        genStartRef.current = null;
        setElapsedSecs(0);
        return;
      }
      if (genStartRef.current === null) genStartRef.current = Date.now();
      const id = setInterval(() => {
        setElapsedSecs(Math.floor((Date.now() - genStartRef.current) / 1000));
      }, 500);
      return () => clearInterval(id);
    }, [streamState]);

    // Broadcast live indicator to session list; clean up on unmount
    uE(() => {
      if (!sessionId) return;
      window.dispatchEvent(new CustomEvent('chat-session-generating', {
        detail: { sessionId, active: isGenerating },
      }));
      return () => window.dispatchEvent(new CustomEvent('chat-session-generating', {
        detail: { sessionId, active: false },
      }));
    }, [isGenerating, sessionId]);

    // Auto-resume: if session mounted with an unanswered user message, submit it.
    // Skip when pendingQuestion is set — that effect already handles the submission
    // and firing both causes a double-request (regression from NLP-5/NLP-7).
    uE(() => {
      if (!sessionId) return;
      if (pendingQuestion) return; // pendingQuestion effect handles this
      const s = store().getSession(sessionId);
      if (!s?.messages?.length) return;
      const last = s.messages[s.messages.length - 1];
      if (last.role === 'user') submitQuestion(last.content, { alreadyAdded: true });
    }, []); // run once on mount

    function onScroll(e) {
      const el = e.target;
      autoScrollRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
    }

    async function submitQuestion(question, { alreadyAdded = false } = {}) {
      if (!question.trim() || streamState !== 'idle') return;

      let sid = sessionId;
      if (!sid) {
        sid = store().createSession(question);
        onSessionCreated && onSessionCreated(sid);
      } else if (!alreadyAdded) {
        store().addUserMessage(sid, question);
      }
      setSession(store().getSession(sid));
      setStreamState('searching');
      setStatusText('searching notes…');
      setStreamText('');
      setActiveRefN(null);

      const agentId = store().getAgentId(sid);
      const sessionMessages = store().getMessagesForResume(sid);

      try {
        const resp = await fetch('/api/ai/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, sessionId: sid, agentId, sessionMessages }),
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let fullText = '';
        let refs = [];
        let followups = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'status') {
                setStreamState('searching');
                setStatusText(ev.text || 'searching…');
              } else if (ev.type === 'token') {
                setStreamState('streaming');
                fullText += ev.text;
                setStreamText(fullText);
              } else if (ev.type === 'references') {
                refs = ev.items || [];
              } else if (ev.type === 'followups') {
                followups = ev.items || [];
              } else if (ev.type === 'done') {
                store().setAgentId(sid, ev.agentId);
                store().addAssistantMessage(sid, ev.answerText || fullText, refs, followups);
                setSession(store().getSession(sid));
                setStreamState('done');
                setStreamText('');
                setTimeout(() => setStreamState('idle'), 50);
              } else if (ev.type === 'error') {
                setStreamState('idle');
                store().addAssistantMessage(sid, `⚠ ${ev.text}`, [], []);
                setSession(store().getSession(sid));
              }
            } catch (parseErr) {}
          }
        }
      } catch (err) {
        setStreamState('idle');
        store().addAssistantMessage(sid, `⚠ ${err.message || 'Connection error'}`, [], []);
        setSession(store().getSession(sid));
      }

      setInputVal('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }

    function handleRefClick(ref) {
      setActiveRefN(ref.n);
      window.dispatchEvent(new CustomEvent('open-note-preview', { detail: { noteId: ref.noteId, n: ref.n } }));
    }

    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        submitQuestion(inputVal);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitQuestion(inputVal);
      }
    }

    const messages = session?.messages || [];

    // Last assistant message's refs and followups (for chips)
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');

    return (
      <div className="chat-pane">
        <div className="chat-messages" ref={messagesRef} onScroll={onScroll}>
          {messages.length === 0 && streamState === 'idle' && (
            <div className="chat-empty">
              <div className="chat-empty-icon">✦</div>
              <div className="chat-empty-title">Ask Horus anything</div>
              <div className="chat-empty-sub">Search across all your notes, tasks, journals, and decisions.</div>
              <div className="chat-empty-cards">
                {['What did I decide about auth?', 'Open tasks this week', 'Summarise Horus UI project'].map(q => (
                  <button key={q} className="chat-empty-card" onClick={() => submitQuestion(q)}>{q}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => {
            if (msg.role === 'user') return (
              <div key={i} className="msg-user">
                <div className="msg-user-bubble">{msg.content}</div>
              </div>
            );
            return (
              <div key={i} className="msg-assistant">
                <div className="msg-assistant-label">✦ Horus</div>
                <div className="msg-assistant-body">
                  {window.MD?.MarkdownBody
                    ? React.createElement(window.MD.MarkdownBody, { body: msg.content, onNavigate: () => {} })
                    : <CitationText text={msg.content} references={msg.references}
                        onCiteClick={handleRefClick} activeRefN={activeRefN} />}
                </div>
                <RefList references={msg.references} activeRefN={activeRefN} onRefClick={handleRefClick} />
              </div>
            );
          })}

          {isGenerating && (
            <div className="msg-assistant">
              <div className="msg-assistant-label">✦ Horus</div>
              {streamState === 'searching' && (
                <div className="msg-thinking">
                  <div className="msg-searching">
                    <div className="pulse-dots">
                      <div className="pulse-dot"></div><div className="pulse-dot"></div><div className="pulse-dot"></div>
                    </div>
                    <span className="msg-status-text">{statusText}{elapsedSecs >= 5 ? ` · ${elapsedSecs}s` : ''}</span>
                  </div>
                  <div className="msg-skeleton">
                    <div className="skeleton-line"></div>
                    <div className="skeleton-line" style={{width: '75%'}}></div>
                    <div className="skeleton-line" style={{width: '55%'}}></div>
                  </div>
                </div>
              )}
              {streamState === 'streaming' && (
                <div className="msg-assistant-body">
                  {window.MD?.renderMarkdown
                    ? <>{window.MD.renderMarkdown(streamText)}<span className="stream-cursor" /></>
                    : <>{streamText}<span className="stream-cursor" /></>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Follow-up chips — after last assistant message */}
        {!isGenerating && lastAssistant?.followups?.length > 0 && (
          <div className="followup-chips" style={{ padding: '0 16px 8px' }}>
            {lastAssistant.followups.map((q, i) => (
              <button key={i} className="followup-chip" onClick={() => submitQuestion(q)}>{q}</button>
            ))}
          </div>
        )}

        {/* Input bar */}
        <div className="chat-input-bar">
          <textarea
            ref={inputRef}
            className="chat-input"
            rows={1}
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isGenerating ? 'Generating…' : (messages.length > 0 ? 'Ask a follow-up… ⌘↵' : 'Ask anything about your notes…')}
            disabled={isGenerating}
            style={{ resize: 'none', overflow: 'hidden' }}
          />
          <button className="chat-send-btn" onClick={() => submitQuestion(inputVal)} disabled={isGenerating || !inputVal.trim()}>↑</button>
        </div>
      </div>
    );
  }

  // ── Note Preview Pane ──────────────────────────────────────────
  function NotePreviewPane({ noteId, refN, onClose, onSwitchToEditor }) {
    const [noteData, setNoteData] = uS(null);
    const [loading, setLoading] = uS(false);
    const noteCache = uR({});

    uE(() => {
      if (!noteId) return;
      if (noteCache.current[noteId]) {
        setNoteData(noteCache.current[noteId]);
        return;
      }
      setLoading(true);
      setNoteData(null);
      fetch(`/api/notes/${noteId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) {
            noteCache.current[noteId] = data;
            setNoteData(data);
          }
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }, [noteId]);

    uE(() => {
      function onKey(e) { if (e.key === 'Escape') onClose(); }
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, []);

    const note = noteData?.note || noteData;

    return (
      <div className="note-preview-pane">
        <div className="preview-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ padding: '1px 6px', border: '1px solid var(--line-soft)', borderRadius: 99, font: '400 7.5px/1 var(--font-mono)', color: 'var(--ink-3)' }}>
              ● {note?.type || '…'}
            </span>
            <span style={{ marginLeft: 'auto', font: '500 8px/1 var(--font-mono)', color: 'var(--nlp)' }}>[{refN}]</span>
          </div>
          {note && <div style={{ font: '600 13px/1.4 Kalam, var(--font-body)', color: 'var(--ink)', marginTop: 4 }}>{note.title}</div>}
          {note?.tags?.length > 0 && (
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 4 }}>
              {note.tags.map(t => (
                <span key={t} style={{ padding: '1px 5px', border: '1px solid var(--line-soft)', borderRadius: 99, font: '400 7.5px/1 var(--font-mono)', color: 'var(--ink-3)' }}>{t}</span>
              ))}
              {note.modified && <span style={{ padding: '1px 5px', border: '1px solid var(--line-soft)', borderRadius: 99, font: '400 7.5px/1 var(--font-mono)', color: 'var(--ink-3)' }}>modified {ageStr(note.modified)}</span>}
            </div>
          )}
          {loading && <div style={{ color: 'var(--ink-3)', font: '400 10px/1 var(--font-mono)', marginTop: 4 }}>Loading…</div>}
        </div>

        <div className="preview-body">
          {note?.body && (window.MD?.MarkdownBody
            ? React.createElement(window.MD.MarkdownBody, { body: note.body, onNavigate: () => {} })
            : <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{note.body}</pre>)}
        </div>

        <div className="preview-ctas">
          <button className="preview-cta-primary" onClick={() => {
            window.dispatchEvent(new CustomEvent('switch-to-editor', { detail: { noteId } }));
          }}>
            <span>☰</span>
            <span style={{ flex: 1 }}>Switch to editor with this note →</span>
          </button>
          <button className="preview-cta-close" onClick={onClose}>✕ Close preview</button>
        </div>
      </div>
    );
  }

  // ── Ask Page ───────────────────────────────────────────────────
  function AskPage({ onNavigate, initialSessionId, sideCollapsed, toggleSide }) {
    const [activeSessionId, setActiveSessionId] = uS(() => {
      if (initialSessionId) return initialSessionId;
      return store().getLastActiveSessionId();
    });
    const [pendingQuestion, setPendingQuestion] = uS(null);
    const [sideTab, setSideTab] = uS('chats');
    const [previewState, setPreviewState] = uS(null); // { noteId, n }
    const [previewWidth, setPreviewWidth] = uS(230);
    const dragRef = uR(null); // { startX, startWidth }

    uE(() => {
      function onOpenPreview(e) { setPreviewState(e.detail); }
      function onSwitchEditor(e) {
        const { noteId } = e.detail;
        window.__chatReturnContext = {
          sessionId: activeSessionId,
          scrollPosition: document.querySelector('.chat-messages')?.scrollTop || 0,
        };
        onNavigate({ kind: 'note', id: noteId });
      }
      window.addEventListener('open-note-preview', onOpenPreview);
      window.addEventListener('switch-to-editor', onSwitchEditor);
      return () => {
        window.removeEventListener('open-note-preview', onOpenPreview);
        window.removeEventListener('switch-to-editor', onSwitchEditor);
      };
    }, [activeSessionId]);

    uE(() => {
      if (activeSessionId) store().setActiveSession(activeSessionId);
    }, [activeSessionId]);

    // Pick up pending query from home page navigation
    uE(() => {
      const pending = window.__pendingAskQuery;
      if (pending) {
        window.__pendingAskQuery = null;
        if (pending.sessionId) setActiveSessionId(pending.sessionId);
        if (pending.question) setPendingQuestion(pending.question);
      }
    }, []);

    // Drag-to-resize: attach global listeners only while dragging
    uE(() => {
      function onMouseMove(e) {
        if (!dragRef.current) return;
        const dx = dragRef.current.startX - e.clientX; // dragging left = wider preview
        const newWidth = Math.max(160, Math.min(600, dragRef.current.startWidth + dx));
        setPreviewWidth(newWidth);
      }
      function onMouseUp() {
        if (!dragRef.current) return;
        dragRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      return () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
    }, []);

    function handleNewSession() {
      const sid = store().createSession();
      setActiveSessionId(sid);
    }

    function handleSelectSession(sid) {
      setActiveSessionId(sid);
    }

    function handleSessionCreated(sid) {
      setActiveSessionId(sid);
    }

    const gridCols = previewState
      ? `var(--side-w) 1fr 4px ${previewWidth}px`
      : 'var(--side-w) 1fr';

    // Agent chat is gated: disabled when the server has no Anthropic key.
    if (window.HORUS_AI_ENABLED === false) {
      return (
        <div className="ask-layout" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="chat-empty" style={{ textAlign: 'center', maxWidth: 460 }}>
            <div className="chat-empty-icon">✦</div>
            <div className="chat-empty-title">Agent chat is not configured</div>
            <div className="chat-empty-sub">
              Set an Anthropic API key to enable the ✦ Ask agent — run
              {' '}<code>horus config set ai.anthropic-key &lt;key&gt;</code>{' '}then{' '}<code>horus up</code>.
            </div>
            <button className="ask-bar-btn" style={{ marginTop: 16 }} onClick={() => onNavigate({ kind: 'home' })}>
              Back to notes
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className={`ask-layout${previewState ? ' preview-open' : ''}${sideCollapsed ? ' side-collapsed' : ''}`} style={{ height: '100%', display: 'grid', gridTemplateColumns: sideCollapsed ? (previewState ? `1fr 4px ${previewWidth}px` : '1fr') : gridCols }}>
        {/* Sidebar with tab switcher */}
        <aside className="side" style={{ gridColumn: 1, gridRow: 1, borderRight: '1px solid var(--line)', display: sideCollapsed ? 'none' : 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <div className="side-tabs">
            <button className={`side-tab${sideTab === 'notes' ? ' active-notes' : ''}`} onClick={() => { setSideTab('notes'); onNavigate({ kind: 'home' }); }}>Notes</button>
            <button className={`side-tab${sideTab === 'chats' ? ' active-chats' : ''}`} onClick={() => setSideTab('chats')}>✦ Chats</button>
          </div>
          {sideTab === 'chats' && (
            <window.ChatSidebar
              activeSessionId={activeSessionId}
              onSelectSession={handleSelectSession}
              onNewSession={handleNewSession}
            />
          )}
        </aside>

        {/* Chat pane */}
        <ChatPane
          key={activeSessionId}
          sessionId={activeSessionId}
          pendingQuestion={pendingQuestion}
          onPendingSubmitted={() => setPendingQuestion(null)}
          onOpenPreview={setPreviewState}
          onSessionCreated={handleSessionCreated}
        />

        {/* Resize handle — only visible when preview is open */}
        {previewState && (
          <div
            className="resize-handle"
            onMouseDown={e => {
              e.preventDefault();
              dragRef.current = { startX: e.clientX, startWidth: previewWidth };
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
          />
        )}

        {/* Note preview pane */}
        {previewState && (
          <NotePreviewPane
            noteId={previewState.noteId}
            refN={previewState.n}
            onClose={() => setPreviewState(null)}
            onSwitchToEditor={(noteId) => {
              window.__chatReturnContext = {
                sessionId: activeSessionId,
                scrollPosition: document.querySelector('.chat-messages')?.scrollTop || 0,
              };
              onNavigate({ kind: 'note', id: noteId });
            }}
          />
        )}
      </div>
    );
  }

  window.AskPage = AskPage;
})();
