import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { ModeProvider } from './context/ModeContext'
import { Shell } from './components/Shell/Shell'
import { Sidebar } from './components/Shell/Sidebar'
import { ModeSelector } from './components/Navigation/ModeSelector'
import { Breadcrumbs } from './components/Navigation/Breadcrumbs'
import { StoriesView } from './views/StoriesView'
import { KnowledgeView } from './views/KnowledgeView'
import { SettingsView } from './views/SettingsView'
import { ForgeView } from './views/ForgeView'
import { NoteView } from './views/NoteView'
import { PageView } from './views/PageView'

function HomeView() {
  return <div style={{ color: 'var(--text-secondary)', marginTop: '40px', textAlign: 'center' }}>
    <h1 style={{ color: 'var(--text-primary)', fontSize: '24px', marginBottom: '8px' }}>Horus</h1>
    <p>Home view — dashboard cards and activity coming in WI-07.</p>
  </div>
}

function HealthDot() {
  return <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--status-green)', display: 'inline-block' }} title="Services healthy" />
}

function AppShell() {
  return (
    <Shell
      sidebar={<Sidebar />}
      topBar={<>
        <ModeSelector />
        <span style={{ flex: 1, display: 'flex', justifyContent: 'center' }}><Breadcrumbs /></span>
        <HealthDot />
      </>}
    >
      <Routes>
        <Route path="/" element={<HomeView />} />
        <Route path="/stories" element={<StoriesView />} />
        <Route path="/knowledge" element={<KnowledgeView />} />
        <Route path="/settings" element={<SettingsView />} />
        <Route path="/forge" element={<ForgeView />} />
        <Route path="/note/:id" element={<NoteView />} />
        <Route path="/page/:id" element={<PageView />} />
      </Routes>
    </Shell>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ModeProvider>
        <AppShell />
      </ModeProvider>
    </BrowserRouter>
  )
}
