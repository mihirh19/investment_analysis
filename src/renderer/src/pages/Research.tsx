import { lazy, Suspense } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import type { ResearchStatus } from '@shared/research'
import { PageHeader } from '../components/Shell'
import { CompanyPage, VIEWS, type View } from '../components/Company'
import { Monitor } from '../components/Monitor'
import { Screener } from '../components/Screener'
import { Button } from '../components/ui'
import { useResearchHome, useSetResearchSync, useWorldMap } from '../lib/api'
import { shortDate, timeAgo } from '../lib/format'

// The map and its drawing library load only when the World tab is opened.
const World = lazy(() => import('../components/World'))

/** "infy fin" → INFY's financials. The last word picks the view when it names one. */
export function parseCommand(text: string): { query: string; view: View | null } {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const last = words.at(-1)?.toLowerCase()
  const view = VIEWS.find((v) => v.codes.includes(last ?? ''))?.key ?? null
  return { query: (view && words.length > 1 ? words.slice(0, -1) : words).join(' '), view }
}

export function Research({ mode }: { mode?: 'screener' | 'world' }) {
  const { symbol } = useParams()
  const [params] = useSearchParams()
  const view = (VIEWS.find((v) => v.key === params.get('view'))?.key ?? 'overview') as View
  return (
    <>
      <PageHeader title={mode === 'screener' ? 'Screener' : mode === 'world' ? 'World' : 'Research'}>{mode === 'world' ? <WorldLine /> : <SyncLine />}</PageHeader>
      {mode === 'screener' ? (
        <Screener />
      ) : mode === 'world' ? (
        <Suspense fallback={<p className="text-[13.5px] text-ink-muted">Loading the map…</p>}>
          <World />
        </Suspense>
      ) : symbol ? (
        <CompanyPage symbol={symbol.toUpperCase()} view={view} />
      ) : (
        <Monitor />
      )}
    </>
  )
}

/** When the World map's data last changed, or that its updates are paused. */
function WorldLine() {
  const d = useWorldMap().data
  if (!d) return null
  const latest = d.sources.map((s) => s.updatedAt).filter((x): x is string => !!x).sort().at(-1) ?? null
  return (
    <span className="text-[13.5px] text-ink-muted" aria-live="polite">
      {!d.enabled ? 'World updates paused' : d.refreshing ? 'Updating world data…' : latest ? `World data updated ${timeAgo(latest)}` : 'Fetching world data for the first time…'}
    </span>
  )
}

function syncText(s: ResearchStatus): string {
  const n = (x: number) => x.toLocaleString('en-IN')
  const of = `${n(s.companiesDone)} of ${n(s.companies)} companies`
  if (s.companies === 0) return 'The company list arrives with the first price refresh'
  if (s.state === 'PAUSED') return `Results download paused, ${of}`
  if (s.state === 'DONE') return `Results in for all ${n(s.companies)} companies`
  const eta =
    s.etaMinutes === null ? '' : s.etaMinutes >= 90 ? `, about ${Math.round(s.etaMinutes / 60)} h left` : `, about ${s.etaMinutes} min left`
  return s.state === 'RUNNING' ? `Downloading results: ${of}${eta}` : `Results: ${of}, resuming shortly`
}

function SyncLine() {
  const home = useResearchHome()
  const toggle = useSetResearchSync()
  const s = home.data?.status
  if (!s) return null
  return (
    <div className="flex items-center gap-3 text-[13.5px] text-ink-muted" aria-live="polite">
      <span>
        {syncText(s)}
        {s.pricesDate && <> · prices of {shortDate(s.pricesDate)}</>}
      </span>
      <Button variant="quiet" className="!px-2.5 !py-0.5 !text-[13px]" disabled={toggle.isPending} onClick={() => toggle.mutate(!s.enabled)}>
        {s.enabled ? 'Pause' : 'Resume'}
      </Button>
    </div>
  )
}
