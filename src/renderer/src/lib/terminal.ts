import { createContext, useContext } from 'react'

// What any part of the app can ask of the terminal around it: open a screen or a tool panel.

export interface TerminalApi {
  /** Shows a screen: in the tab that has focus, or a new tab. */
  openScreen(route: string, opts?: { newTab?: boolean }): void
  /** Adds a tool panel (chart, watchlist…) next to the focused tab. */
  openPanel(kind: string, params?: Record<string, unknown>): void
  /** Opens the list of every screen. */
  openMenu(): void
}

export const TerminalCtx = createContext<TerminalApi | null>(null)

export function useTerminal(): TerminalApi | null {
  return useContext(TerminalCtx)
}
