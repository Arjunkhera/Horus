import { createContext, useContext, useState } from 'react'

const ModeContext = createContext(null)

export const MODES = [
  { id: 'anvil', label: 'Anvil' },
  { id: 'vault', label: 'Vault' },
  { id: 'forge', label: 'Forge' },
]

export function ModeProvider({ children }) {
  const [mode, setMode] = useState('anvil')
  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>
}

export const useMode = () => useContext(ModeContext)
