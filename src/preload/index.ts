import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, CHAT_EVENT, MARKET_UPDATED, RESEARCH_UPDATED } from '@shared/api'
import type { ChatEvent } from '@shared/ai'
import type { Api } from '@shared/types'

const api = {
  ...Object.fromEntries(
    API_METHODS.map((name) => [name, (...args: unknown[]) => ipcRenderer.invoke(`api:${name}`, ...args)])
  ),
  onMarketUpdate(listener: () => void) {
    const handler = () => listener()
    ipcRenderer.on(MARKET_UPDATED, handler)
    return () => ipcRenderer.removeListener(MARKET_UPDATED, handler)
  },
  onChatEvent(listener: (e: ChatEvent) => void) {
    const handler = (_: unknown, e: ChatEvent) => listener(e)
    ipcRenderer.on(CHAT_EVENT, handler)
    return () => ipcRenderer.removeListener(CHAT_EVENT, handler)
  },
  onResearchUpdate(listener: () => void) {
    const handler = () => listener()
    ipcRenderer.on(RESEARCH_UPDATED, handler)
    return () => ipcRenderer.removeListener(RESEARCH_UPDATED, handler)
  }
} as unknown as Api

contextBridge.exposeInMainWorld('api', api)
