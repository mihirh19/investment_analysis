import { useEffect, useRef } from 'react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import type { IDockviewPanelProps } from 'dockview-react'
import { AppRoutes } from './routes'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { SectionTabs } from '../components/Shell'
import { titleFor } from '../lib/nav'

/** How to move each open screen tab to another route, by panel id (set while the tab is mounted). */
export const navigators = new Map<string, (route: string) => void>()

export interface ScreenParams {
  route: string
}

/** A terminal tab showing one of the app's screens. It has its own history, like a browser tab. */
export function ScreenPanel(p: IDockviewPanelProps<ScreenParams>) {
  return (
    <MemoryRouter initialEntries={[p.params.route || '/']}>
      <ScreenBody p={p} />
    </MemoryRouter>
  )
}

function ScreenBody({ p }: { p: IDockviewPanelProps<ScreenParams> }) {
  const location = useLocation()
  const navigate = useNavigate()
  const scroller = useRef<HTMLDivElement>(null)
  const route = location.pathname + location.search
  const id = p.api.id

  useEffect(() => {
    navigators.set(id, (r) => navigate(r))
    return () => {
      navigators.delete(id)
    }
  }, [id, navigate])

  // The tab's title and saved route follow wherever the screen goes; each new screen starts at the top.
  useEffect(() => {
    p.api.setTitle(titleFor(route))
    if (p.params.route !== route) p.api.updateParameters({ ...p.params, route })
    scroller.current?.scrollTo(0, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route])

  const wide = location.pathname === '/research/world'
  return (
    // The container (for the screens' tab-width layouts, and for slide-over panels) stays put while the
    // inner element scrolls, so a slide-over covers the visible tab rather than scrolling away.
    <div className="@container relative h-full bg-paper" data-screen={location.pathname}>
      <div ref={scroller} className="h-full overflow-y-auto">
        <div className={'mx-auto px-5 pt-3 pb-12 ' + (wide ? 'max-w-[1900px]' : 'max-w-[1320px]')}>
          <SectionTabs pathname={location.pathname} />
          <ErrorBoundary resetKey={route}>
            {/* Keyed by route so each screen plays its entrance once. */}
            <div key={location.pathname} className="anim-page">
              <AppRoutes />
            </div>
          </ErrorBoundary>
        </div>
      </div>
    </div>
  )
}
