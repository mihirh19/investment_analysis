import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, MARKET_UPDATED } from '@shared/api'
import type { Api } from '@shared/types'

const api = {
  ...Object.fromEntries(
    API_METHODS.map((name) => [name, (...args: unknown[]) => ipcRenderer.invoke(`api:${name}`, ...args)])
  ),
  onMarketUpdate(listener: () => void) {
    const handler = () => listener()
    ipcRenderer.on(MARKET_UPDATED, handler)
    return () => ipcRenderer.removeListener(MARKET_UPDATED, handler)
  }
} as unknown as Api

contextBridge.exposeInMainWorld('api', api)
