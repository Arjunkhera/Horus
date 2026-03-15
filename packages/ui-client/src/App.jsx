import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useState } from 'react'
import { ModeProvider } from './context/ModeContext'
import { DashboardProvider } from './components/Dashboards/DashboardContext'
import { Shell } from './components/Shell/Shell'
import { Sidebar } from './components/Shell/Sidebar'
import { ModeSelector } from './components/Navigation/ModeSelector'
import { Breadcrumbs } from './components/Navigation/Breadcrumbs'
import { HealthIndicator } from './components/Health/HealthIndicator'
import { ChatBar } from './components/ChatBar'
import { HomeView } from './views/HomeView'
import { StoriesView } from './views/StoriesView'
import { KnowledgeView } from './views/KnowledgeView'
import { SettingsView } from './views/SettingsView'
import { ForgeView } from './views/ForgeView'
import { NoteView } from './views/NoteView'
import { PageView } from './views/PageView'
import { PinnedSection } from './components/Dashboards/PinnedSection'
import { DashboardView } from './components/Dashboards/DashboardView'
import { useDashboards } from './components/Dashboards/DashboardContext'
import { registry } from './primitives/PrimitiveRegistry'

function QueryResults({ contract, primitiveId }) {
  if (!contract) return null
  const { component: Primitive } = registry.selectPrimitive(contract.shape, primitiveId) ?? {}
  if (!Primitive) return <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No results for '{contract.query}'</p>
  if (!contract.items?.length) return <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No results for '{contract.query}'</p>
  return <Primitive data={contract} />
}

function AppShell() {
  const { activeDashboardId } = useDashboards()
  const [queryResult, setQueryResult] = useState(null)
  const [activePrimitive, setActivePrimitive] = useState(null)

  const handleResults = (contract, primitiveId) => {
    setQueryResult(contract)
    setActivePrimitive(primitiveId)
  }

  return (
    <Shell
      sidebar={<Sidebar pinnedSection={<PinnedSection />} />}
      topBar={<>
        <ModeSelector />
        <span style={{ flex: 1, display: 'flex', justifyContent: 'center' }}><Breadcrumbs /></span>
        <HealthIndicator />
      </>}
      chatBar={<ChatBar onResults={handleResults} />}
    >
      {activeDashboardId ? <DashboardView /> :
       queryResult      ? <QueryResults contract={queryResult} primitiveId={activePrimitive} /> :
       <Routes>
         <Route path="/" element={<HomeView />} />
         <Route path="/stories" element={<StoriesView />} />
         <Route path="/knowledge" element={<KnowledgeView />} />
         <Route path="/settings" element={<SettingsView />} />
         <Route path="/forge" element={<ForgeView />} />
         <Route path="/note/:id" element={<NoteView />} />
         <Route path="/page/:id" element={<PageView />} />
       </Routes>
      }
    </Shell>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ModeProvider>
        <DashboardProvider>
          <AppShell />
        </DashboardProvider>
      </ModeProvider>
    </BrowserRouter>
  )
}
