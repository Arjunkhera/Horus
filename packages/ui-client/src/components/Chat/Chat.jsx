/**
 * Chat — the primary interaction surface.
 * Uses Vercel AI SDK useChat for streaming + tool orchestration.
 * Updated for @ai-sdk/react v3: input/setInput/handleSubmit/isLoading removed.
 */
import { useChat } from '@ai-sdk/react'
import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageParts } from './MessageParts'

export function Chat({ conversationId, onConversationChange, onPin }) {
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const [apiKeyMissing, setApiKeyMissing] = useState(false)
  const [input, setInput] = useState('')

  const {
    messages,
    status,
    error,
    setMessages,
    sendMessage,
    addToolResult,
  } = useChat({
    api: '/api/chat',
    maxSteps: 10,
    onToolCall({ toolCall }) {
      // Client-side tool: renderView — return synthetic success
      if (toolCall.toolName === 'renderView') {
        return { success: true, rendered: toolCall.args?.primitive }
      }
    },
    onError(err) {
      if (err?.message?.includes('no_api_key')) {
        setApiKeyMissing(true)
      }
    },
  })

  const isLoading = status === 'submitted' || status === 'streaming'

  // Check API key status on mount
  useEffect(() => {
    fetch('/api/chat/status')
      .then(r => r.json())
      .then(data => setApiKeyMissing(!data.configured))
      .catch(() => {})
  }, [])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus() }, [])

  // Load conversation messages when conversationId changes
  const loadConversation = useCallback(async (id) => {
    if (!id) { setMessages([]); return }
    try {
      const res = await fetch(`/api/conversations/${id}`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages ?? [])
      }
    } catch { /* fresh conversation */ }
  }, [setMessages])

  useEffect(() => { loadConversation(conversationId) }, [conversationId, loadConversation])

  // Save conversation after each assistant message completes
  useEffect(() => {
    if (!conversationId || isLoading || !messages.length) return
    const lastMsg = messages[messages.length - 1]
    if (lastMsg?.role !== 'assistant') return

    const userMsg = messages.find(m => m.role === 'user')
    const title = (typeof userMsg?.content === 'string' ? userMsg.content : '').slice(0, 50) || 'New conversation'
    fetch(`/api/conversations/${conversationId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, messages }),
    }).catch(() => {})
    onConversationChange?.()
  }, [messages, isLoading, conversationId, onConversationChange])

  const handleSubmit = (e) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || isLoading) return
    sendMessage(text)
    setInput('')
  }

  if (apiKeyMissing) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', maxWidth: '400px' }}>
          <p style={{ fontSize: '16px', marginBottom: '12px' }}>No Anthropic API key configured</p>
          <p style={{ fontSize: '13px' }}>Set the <code style={{ background: 'var(--bg-tertiary)', padding: '1px 5px', borderRadius: '3px' }}>ANTHROPIC_API_KEY</code> environment variable or configure it in Settings.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Messages */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto', padding: '16px 24px',
        display: 'flex', flexDirection: 'column', gap: '16px',
      }}>
        {messages.length === 0 && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', fontSize: '14px',
          }}>
            Ask Horus anything — search notes, view stories, explore knowledge.
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
            gap: '4px',
          }}>
            {msg.role === 'user' ? (
              <div style={{
                background: 'var(--accent)', color: 'white', borderRadius: '12px 12px 2px 12px',
                padding: '8px 14px', maxWidth: '70%', fontSize: '14px', lineHeight: 1.5,
              }}>
                {typeof msg.content === 'string' ? msg.content : msg.parts?.find(p => p.type === 'text')?.text || ''}
              </div>
            ) : (
              <div style={{ maxWidth: '90%', width: '100%' }}>
                {msg.parts ? (
                  <MessageParts parts={msg.parts} onPin={onPin} />
                ) : (
                  <div style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--text-primary)' }}>
                    {msg.content}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {isLoading && messages[messages.length - 1]?.role === 'user' && (
          <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Thinking…</div>
        )}

        {error && (
          <div style={{ color: 'var(--status-red)', fontSize: '13px', padding: '8px' }}>
            Error: {error.message}
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} style={{
        borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)',
        display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px',
      }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask Horus..."
          disabled={isLoading}
          style={{
            flex: 1, background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
            borderRadius: '8px', padding: '10px 14px', outline: 'none',
            color: 'var(--text-primary)', fontSize: '14px',
          }}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          style={{
            background: input.trim() && !isLoading ? 'var(--accent)' : 'var(--bg-tertiary)',
            border: 'none', borderRadius: '8px', color: 'white',
            cursor: input.trim() && !isLoading ? 'pointer' : 'default',
            fontSize: '14px', padding: '10px 16px', opacity: input.trim() && !isLoading ? 1 : 0.5,
          }}
        >
          Send
        </button>
      </form>
    </div>
  )
}
