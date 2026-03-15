import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const DashboardContext = createContext(null)

export function DashboardProvider({ children }) {
  const [dashboards, setDashboards] = useState([])
  const [activeDashboardId, setActiveDashboardId] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/config/dashboards')
      const data = await res.json()
      setDashboards(data.dashboards ?? [])
    } catch { /* server not ready yet */ }
  }, [])

  useEffect(() => { load() }, [load])

  const save = useCallback(async (next) => {
    setDashboards(next)
    await fetch('/api/config/dashboards', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dashboards: next }),
    })
  }, [])

  const addDashboard = useCallback(async (name) => {
    const id = crypto.randomUUID()
    const entry = { id, name, icon: '◈', color: 'var(--accent)', artifact: null }
    await save([...dashboards, entry])
    return id
  }, [dashboards, save])

  const reorder = useCallback(async (fromIdx, toIdx) => {
    const next = [...dashboards]
    const [item] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, item)
    await save(next)
  }, [dashboards, save])

  return (
    <DashboardContext.Provider value={{ dashboards, activeDashboardId, setActiveDashboardId, addDashboard, reorder, reload: load }}>
      {children}
    </DashboardContext.Provider>
  )
}

export const useDashboards = () => useContext(DashboardContext)
