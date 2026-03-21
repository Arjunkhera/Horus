import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useState, useCallback } from 'react'
import { DashboardProvider } from './components/Dashboards/DashboardContext'
import { Shell } from './components/Shell/Shell'
import { Sidebar } from './components/Shell/Sidebar'
import { HealthIndicator } from './components/Health/HealthIndicator'
import { Chat } from './components/Chat/Chat'
import { ConversationList } from './components/Chat/ConversationList'
import { PinnedSection } from './components/Dashboards/PinnedSection'
import { SettingsView } from './views/SettingsView'
import { NoteView } from './views/NoteView'
import { PageView } from './views/PageView'
import './primitives' // register primitives

function AppShell() {
  const [conversationId, setConversationId] = useState(() =>
    localStorage.getItem('horus:activeConversation') || null
  )
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  const handleSelect = useCallback((id) => {
    setConversationId(id)
    localStorage.setItem('horus:activeConversation', id)
  }, [])

  const handleNew = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      handleSelect(data.id)
      setRefreshTrigger(t => t + 1)
    } catch { /* ignore */ }
  }, [handleSelect])

  const handleConversationChange = useCallback(() => {
    setRefreshTrigger(t => t + 1)
  }, [])

  const handlePin = useCallback((renderViewInput) => {
    // TODO: wire to dashboard persistence
    console.log('Pin view:', renderViewInput)
  }, [])

  return (
    <Shell
      sidebar={
        <Sidebar
          conversationList={
            <ConversationList
              activeId={conversationId}
              onSelect={handleSelect}
              onNew={handleNew}
              refreshTrigger={refreshTrigger}
            />
          }
          pinnedSection={<PinnedSection />}
        />
      }
      topBar={
        <>
          <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-secondary)' }}>Chat</span>
          <span style={{ flex: 1 }} />
          <HealthIndicator />
        </>
      }
    >
      <Routes>
        <Route path="/settings" element={<SettingsView />} />
        <Route path="/note/:id" element={<NoteView />} />
        <Route path="/page/:id" element={<PageView />} />
        <Route path="*" element={
          <Chat
            conversationId={conversationId}
            onConversationChange={handleConversationChange}
            onPin={handlePin}
          />
        } />
      </Routes>
    </Shell>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <DashboardProvider>
        <AppShell />
      </DashboardProvider>
    </BrowserRouter>
  )
}
