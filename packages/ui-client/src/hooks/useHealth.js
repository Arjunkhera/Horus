import { useState, useEffect, useCallback } from 'react'

export function useHealth(pollInterval = 30000) {
  const [state, setState] = useState({ overall: 'unknown', services: [], loading: true, error: null })

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/health', { signal: AbortSignal.timeout(5000) })
      const data = await res.json()
      setState({ overall: data.overall, services: data.services ?? [], loading: false, error: null })
    } catch (err) {
      setState(s => ({ ...s, loading: false, error: err.message }))
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, pollInterval)
    return () => clearInterval(id)
  }, [refresh, pollInterval])

  return { ...state, refresh }
}
