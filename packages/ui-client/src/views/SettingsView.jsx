import { useState, useEffect, useCallback } from 'react'

// Step 5: Updated TABS array — Preferences added
const TABS = ['Services', 'LLM', 'Preferences', 'Setup']

const SETUP_STEPS = [
  { id: 'runtime',   label: 'Container Runtime',   endpoint: '/api/setup/detect-runtime' },
  { id: 'datadir',   label: 'Data Directory',       endpoint: '/api/setup/verify-datadir' },
  { id: 'services',  label: 'Configure Services',   endpoint: '/api/setup/configure' },
  { id: 'images',    label: 'Pull Images',          endpoint: '/api/setup/pull-images' },
  { id: 'clients',   label: 'Connect AI Clients',   endpoint: '/api/setup/connect-clients' },
  { id: 'llm',       label: 'LLM Key',             endpoint: '/api/setup/verify-llm' },
]

const DOT_COLOR = {
  healthy:   'var(--status-green)',
  degraded:  'var(--status-yellow)',
  unhealthy: 'var(--status-red)',
  unknown:   'var(--text-muted)',
}

function TabBar({ active, setActive }) {
  return (
    <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border)', marginBottom: '24px' }}>
      {TABS.map(tab => (
        <button key={tab} onClick={() => setActive(tab)} style={{
          padding: '8px 20px', background: 'none',
          border: 'none', borderBottom: active === tab ? '2px solid var(--accent)' : '2px solid transparent',
          color: active === tab ? 'var(--text-primary)' : 'var(--text-secondary)',
          cursor: 'pointer', fontSize: '13px', fontWeight: active === tab ? 600 : 400,
          marginBottom: '-1px',
        }}>{tab}</button>
      ))}
    </div>
  )
}

function Field({ label, hint, value, onChange, type = 'text' }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>{label}</label>
      {hint && <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>{hint}</p>}
      <input type={type} value={value} onChange={e => onChange(e.target.value)} style={{
        width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
        borderRadius: '5px', color: 'var(--text-primary)', fontSize: '13px', padding: '7px 10px',
        boxSizing: 'border-box',
      }} />
    </div>
  )
}

// Step 2: ServicesHealthPanel — fetches /api/health and shows live service rows
function ServicesHealthPanel() {
  const [health, setHealth] = useState({ overall: 'unknown', services: [], loading: true, error: null })

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/health', { signal: AbortSignal.timeout(5000) })
      const data = await res.json()
      setHealth({ overall: data.overall, services: data.services ?? [], loading: false, error: null })
    } catch (err) {
      setHealth(s => ({ ...s, loading: false, error: err.message }))
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 30000)
    return () => clearInterval(id)
  }, [refresh])

  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Live Service Status</label>
        <button onClick={refresh} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '11px', color: 'var(--text-muted)', padding: '2px 6px',
        }}>Refresh</button>
      </div>
      {health.loading
        ? <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '8px 0' }}>Checking services…</div>
        : health.error
          ? <div style={{ fontSize: '12px', color: 'var(--status-red)', padding: '8px 0' }}>Error: {health.error}</div>
          : health.services.length === 0
            ? <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '8px 0' }}>No services reported.</div>
            : health.services.map(svc => (
                <div key={svc.name} style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '8px 12px', background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border)', borderRadius: '6px', marginBottom: '6px',
                }}>
                  <span style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: DOT_COLOR[svc.status] ?? 'var(--text-muted)', flexShrink: 0,
                  }} />
                  <span style={{ flex: 1, fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', textTransform: 'capitalize' }}>{svc.name}</span>
                  {svc.url && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{svc.url.split(':').pop()}</span>}
                  <span style={{ fontSize: '11px', color: DOT_COLOR[svc.status] ?? 'var(--text-muted)' }}>{svc.status}</span>
                  {svc.latency != null && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{svc.latency}ms</span>}
                </div>
              ))
      }
    </div>
  )
}

function ServicesTab({ prefs, setPrefs, saved, onSave, onReset }) {
  const svc = prefs.services ?? {}
  const set = (k, v) => setPrefs(p => ({ ...p, services: { ...(p.services ?? {}), [k]: v } }))
  return (
    <div>
      {/* Step 2: Live stack values panel */}
      <ServicesHealthPanel />

      <Field label="Horus Data Root" hint="Absolute path to HORUS_DATA_PATH" value={svc.dataRoot ?? ''} onChange={v => set('dataRoot', v)} />
      <Field label="Anvil Notes Path" hint="Usually {dataRoot}/notes" value={svc.anvilNotes ?? ''} onChange={v => set('anvilNotes', v)} />
      <Field label="Vault KB Path" hint="Usually {dataRoot}/vault" value={svc.vaultKb ?? ''} onChange={v => set('vaultKb', v)} />
      <Field label="Forge Workspaces Path" hint="Usually {dataRoot}/workspaces" value={svc.forgeWorkspaces ?? ''} onChange={v => set('forgeWorkspaces', v)} />
      <div style={{ marginBottom: '16px' }}>
        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>Container Runtime</label>
        <div style={{ display: 'flex', gap: '8px' }}>
          {['Docker', 'Podman'].map(rt => (
            <button key={rt} onClick={() => set('runtime', rt.toLowerCase())} style={{
              padding: '5px 14px', borderRadius: '5px', cursor: 'pointer', fontSize: '13px',
              background: (svc.runtime ?? 'docker') === rt.toLowerCase() ? 'var(--accent)' : 'var(--bg-tertiary)',
              border: '1px solid var(--border)', color: (svc.runtime ?? 'docker') === rt.toLowerCase() ? 'white' : 'var(--text-secondary)',
            }}>{rt}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={onSave} style={{ padding: '7px 18px', background: 'var(--accent)', border: 'none', borderRadius: '5px', color: 'white', cursor: 'pointer', fontSize: '13px' }}>
          {saved ? '✓ Saved' : 'Save'}
        </button>
        <button onClick={onReset} style={{ padding: '7px 14px', background: 'none', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px' }}>Reset to Defaults</button>
      </div>
    </div>
  )
}

function LLMTab({ prefs, setPrefs, saved, onSave }) {
  const llm = prefs.llm ?? {}
  const set = (k, v) => setPrefs(p => ({ ...p, llm: { ...(p.llm ?? {}), [k]: v } }))
  const [showKey, setShowKey] = useState(false)
  const provider = llm.provider ?? 'none'
  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Provider</label>
        <select value={provider} onChange={e => set('provider', e.target.value)} style={{
          background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
          borderRadius: '5px', color: 'var(--text-primary)', fontSize: '13px', padding: '7px 10px', width: '100%',
        }}>
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="none">None</option>
        </select>
      </div>
      {provider === 'none'
        ? <div style={{ padding: '10px 14px', background: 'var(--bg-tertiary)', border: '1px solid var(--status-yellow)', borderRadius: '6px', marginBottom: '16px', fontSize: '13px', color: 'var(--status-yellow)' }}>
            Artifact generation disabled. Everything else works.
          </div>
        : <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>API Key</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input type={showKey ? 'text' : 'password'} value={llm.apiKey ?? ''} onChange={e => set('apiKey', e.target.value)}
                placeholder={provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
                style={{ flex: 1, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-primary)', fontSize: '13px', padding: '7px 10px' }} />
              <button onClick={() => setShowKey(s => !s)} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 10px' }}>
                {showKey ? '🙈' : '👁'}
              </button>
            </div>
          </div>
      }
      <button onClick={onSave} style={{ padding: '7px 18px', background: 'var(--accent)', border: 'none', borderRadius: '5px', color: 'white', cursor: 'pointer', fontSize: '13px' }}>
        {saved ? '✓ Saved' : 'Save'}
      </button>
    </div>
  )
}

// Step 3: Preferences tab with user.name edit
function PreferencesTab({ prefs, setPrefs, saved, onSave }) {
  const user = prefs.user ?? {}
  const set = (k, v) => setPrefs(p => ({ ...p, user: { ...(p.user ?? {}), [k]: v } }))
  return (
    <div>
      <Field
        label="Display Name"
        hint="Your name, shown in the UI and passed to the assistant as context."
        value={user.name ?? ''}
        onChange={v => set('name', v)}
      />
      <button onClick={onSave} style={{ padding: '7px 18px', background: 'var(--accent)', border: 'none', borderRadius: '5px', color: 'white', cursor: 'pointer', fontSize: '13px' }}>
        {saved ? '✓ Saved' : 'Save'}
      </button>
    </div>
  )
}

function SetupTab({ prefs, setPrefs }) {
  const progress = prefs.settings?.setupProgress ?? {}
  const [running, setRunning] = useState(null)
  const [errors, setErrors] = useState({})

  const runStep = async (step) => {
    setRunning(step.id); setErrors(e => ({ ...e, [step.id]: null }))
    try {
      const res = await fetch(step.endpoint, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      setPrefs(p => ({ ...p, settings: { ...(p.settings ?? {}), setupProgress: { ...(p.settings?.setupProgress ?? {}), [step.id]: true } } }))
      await fetch('/api/config/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { setupProgress: { ...progress, [step.id]: true } } }) })
    } catch (err) {
      setErrors(e => ({ ...e, [step.id]: err.message }))
    } finally { setRunning(null) }
  }

  let foundActive = false
  return (
    <div>
      {SETUP_STEPS.map((step, i) => {
        const done = !!progress[step.id]
        const isActive = !done && !foundActive; if (isActive) foundActive = true
        const icon = done ? '✓' : isActive ? '→' : '○'
        return (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: i < SETUP_STEPS.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
            <span style={{ fontSize: '14px', color: done ? 'var(--status-green)' : isActive ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0, width: '16px' }}>{icon}</span>
            <span style={{ flex: 1, fontSize: '13px', color: done ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{step.label}</span>
            {errors[step.id] && <span style={{ fontSize: '11px', color: 'var(--status-red)' }}>{errors[step.id]}</span>}
            {isActive && (
              <button onClick={() => runStep(step)} disabled={running === step.id} style={{
                padding: '4px 12px', background: 'var(--accent)', border: 'none', borderRadius: '4px',
                color: 'white', cursor: 'pointer', fontSize: '12px', flexShrink: 0,
              }}>{running === step.id ? '…' : 'Run'}</button>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function SettingsView() {
  const [tab, setTab] = useState('Services')
  const [prefs, setPrefs] = useState({})
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  // Step 1: Loading state guard
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/config/preferences')
      .then(r => r.json())
      .then(data => { setPrefs(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const wrappedSetPrefs = (fn) => { setPrefs(fn); setDirty(true); setSaved(false) }

  const save = async () => {
    await fetch('/api/config/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prefs) })
    setSaved(true); setDirty(false)
    setTimeout(() => setSaved(false), 2000)
  }

  const reset = () => { setPrefs(p => ({ ...p, services: {} })); setDirty(true) }

  // Step 4: Fixed layout — full-width container with padding, maxWidth on inner content only
  return (
    <div style={{ padding: '24px 32px', width: '100%', boxSizing: 'border-box' }}>
      <h1 style={{ fontSize: '18px', color: 'var(--text-primary)', marginBottom: '20px', fontWeight: 600 }}>Settings</h1>

      {/* Step 1: Loading guard — don't flash empty tabs */}
      {loading
        ? <div style={{ fontSize: '13px', color: 'var(--text-muted)', paddingTop: '8px' }}>Loading…</div>
        : <>
            <TabBar active={tab} setActive={t => { if (dirty && !confirm('Unsaved changes — leave anyway?')) return; setTab(t); setDirty(false) }} />
            {/* Step 4: maxWidth scoped to tab content area */}
            <div style={{ maxWidth: '520px' }}>
              {tab === 'Services'    && <ServicesTab prefs={prefs} setPrefs={wrappedSetPrefs} saved={saved} onSave={save} onReset={reset} />}
              {tab === 'LLM'         && <LLMTab prefs={prefs} setPrefs={wrappedSetPrefs} saved={saved} onSave={save} />}
              {tab === 'Preferences' && <PreferencesTab prefs={prefs} setPrefs={wrappedSetPrefs} saved={saved} onSave={save} />}
              {tab === 'Setup'       && <SetupTab prefs={prefs} setPrefs={wrappedSetPrefs} />}
            </div>
          </>
      }
    </div>
  )
}
