import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './styles.css'
import { ScopeProvider } from './lib/scope'
import { PeriodProvider } from './lib/period'
import { LinksProvider } from './lib/links'
import { Terminal } from './terminal/Terminal'
import { Simple } from './simple/Simple'
import { useTheme } from './lib/api'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } })

/** The terminal, or the simple look (the default), as chosen in Settings. */
function Look() {
  const theme = useTheme()
  const t = theme.data
  useEffect(() => {
    document.documentElement.classList.toggle('simple', t === 'simple')
    document.documentElement.classList.toggle('terminal', t === 'terminal')
  }, [t])
  if (!t) return null
  return t === 'terminal' ? <Terminal /> : <Simple />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ScopeProvider>
        <PeriodProvider>
          <LinksProvider>
            <Look />
          </LinksProvider>
        </PeriodProvider>
      </ScopeProvider>
    </QueryClientProvider>
  </StrictMode>
)
