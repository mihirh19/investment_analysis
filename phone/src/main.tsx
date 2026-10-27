import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { DataProvider } from './lib/data'
import { LangProvider } from './lib/i18n'
import './styles.css'

if ('serviceWorker' in navigator) void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <DataProvider>
        <App />
      </DataProvider>
    </LangProvider>
  </StrictMode>
)
