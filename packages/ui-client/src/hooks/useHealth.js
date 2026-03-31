import { useState, useEffect, useCallback } from 'react'

export function useHealth(pollInterval = 30000) {
  const [state, setState] = useState({ overall: 'unknown', services: [], checkedAt: null, loading: true, error: null })

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/health', { signal: AbortSignal.timeout(5000) })
      const data = await res.json()
      setState({
        overall: data.overall,
        services: data.services ?? [],
        checkedAt: data.checkedAt ?? null,
        loading: false,
        error: null,
      })
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
