import { createContext, useContext, useState, type ReactNode } from 'react'

interface KeyboardNavigationValue {
  focusedItemId: string | null
  setFocusedItemId: (id: string | null) => void
}

const KeyboardNavigationContext = createContext<KeyboardNavigationValue | null>(null)

export function KeyboardNavigationProvider({ children }: { children: ReactNode }) {
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null)

  return (
    <KeyboardNavigationContext.Provider
      value={{ focusedItemId, setFocusedItemId }}
    >
      {children}
    </KeyboardNavigationContext.Provider>
  )
}

export function useKeyboardNavigationContext() {
  const ctx = useContext(KeyboardNavigationContext)
  if (!ctx) throw new Error('useKeyboardNavigationContext must be used within KeyboardNavigationProvider')
  return ctx
}
