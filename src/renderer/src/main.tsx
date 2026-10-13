import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HashRouter, Route, Routes } from 'react-router-dom'
import './styles.css'
import { Shell } from './components/Shell'
import { ScopeProvider } from './lib/scope'
import { Overview } from './pages/Overview'
import { Holdings } from './pages/Holdings'
import { Activity } from './pages/Activity'
import { ImportPage } from './pages/Import'
import { People } from './pages/People'
import { Exposure } from './pages/Exposure'
import { Dividends } from './pages/Dividends'
import { Retirement } from './pages/Retirement'
import { Insurance } from './pages/Insurance'
import { Settings } from './pages/Settings'
import { Analysis } from './pages/Analysis'
import { Performance } from './pages/Performance'
import { Tax } from './pages/Tax'
import { Funds } from './pages/Funds'
import { OtherAssets } from './pages/OtherAssets'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ScopeProvider>
        <HashRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Overview />} />
              <Route path="holdings" element={<Holdings />} />
              <Route path="activity" element={<Activity />} />
              <Route path="import" element={<ImportPage />} />
              <Route path="people" element={<People />} />
              <Route path="exposure" element={<Exposure />} />
              <Route path="dividends" element={<Dividends />} />
              <Route path="retirement" element={<Retirement />} />
              <Route path="insurance" element={<Insurance />} />
              <Route path="settings" element={<Settings />} />
              <Route path="analysis" element={<Analysis />} />
              <Route path="performance" element={<Performance />} />
              <Route path="tax" element={<Tax />} />
              <Route path="funds" element={<Funds />} />
              <Route path="other-assets" element={<OtherAssets />} />
            </Route>
          </Routes>
        </HashRouter>
      </ScopeProvider>
    </QueryClientProvider>
  </StrictMode>
)
