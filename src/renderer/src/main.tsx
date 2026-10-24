import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './styles.css'
import { ScopeProvider } from './lib/scope'
import { PeriodProvider } from './lib/period'
import { LinksProvider } from './lib/links'
import { Terminal } from './terminal/Terminal'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ScopeProvider>
        <PeriodProvider>
          <LinksProvider>
            <Terminal />
          </LinksProvider>
        </PeriodProvider>
      </ScopeProvider>
    </QueryClientProvider>
  </StrictMode>
)
