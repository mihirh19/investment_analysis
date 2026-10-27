import { useMemo, useState } from 'react'
import { ANN_TAG_LABEL, ANN_TAGS, type Announcement, type AnnTag } from '@shared/research'
import { ErrorNote, PageHeader } from '../components/Shell'
import { Button } from '../components/ui'
import { openExternal, useAiStatus, useAnnouncements, useWriteNewsDigest } from '../lib/api'
import { timeAgo } from '../lib/format'
import { useOpenSymbol } from '../lib/links'
import { ChatMarkdown } from '../lib/markdown'

type Scope = 'mine' | 'market'

/** What companies told the exchange: yours in full, the rest of the market when it's a deal, order, rating, legal or capital matter. */
export function News() {
  const q = useAnnouncements()
  const ai = useAiStatus()
  const digest = useWriteNewsDigest()
  const open = useOpenSymbol()
  const [scope, setScope] = useState<Scope>('mine')
  const [routine, setRoutine] = useState(false)
  const [tag, setTag] = useState<AnnTag | null>(null)
  const r = q.data
  const list: (Announcement & { held?: boolean; watched?: boolean })[] = useMemo(
    () => (scope === 'mine' ? (r?.mine ?? []) : (r?.market ?? [])).filter((a) => (routine || a.tag !== 'routine') && (!tag || a.tag === tag)),
    [r, scope, routine, tag]
  )
  const counts = useMemo(() => {
    const c = new Map<AnnTag, number>()
    for (const a of scope === 'mine' ? (r?.mine ?? []) : (r?.market ?? [])) if (routine || a.tag !== 'routine') c.set(a.tag, (c.get(a.tag) ?? 0) + 1)
    return c
  }, [r, scope, routine])

  // Grouped by day, newest first.
  const days = useMemo(() => {
    const by = new Map<string, typeof list>()
    for (const a of list) {
      const d = a.at.slice(0, 10)
      by.set(d, [...(by.get(d) ?? []), a])
    }
    return [...by]
  }, [list])

  return (
    <>
      <PageHeader title="Announcements">
        {r?.updatedAt && <span className="text-[12.5px] text-ink-muted">From NSE, checked {timeAgo(r.updatedAt)}</span>}
      </PageHeader>
      <ErrorNote error={q.error ?? digest.error} />

      {scope === 'mine' && (r?.mine.length ?? 0) > 0 && (
        <section className="mb-6 max-w-[90ch] rounded-sm border border-rule bg-sheet px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-stamp">What matters this week</h2>
            {ai.data?.newsDigest ? (
              <Button variant="quiet" className="!px-2.5 !py-0.5 !text-[13px]" disabled={digest.isPending} onClick={() => digest.mutate([])}>
                {digest.isPending ? 'Claude is reading…' : r?.digest ? 'Write it again' : 'Write a digest with Claude'}
              </Button>
            ) : (
              <span className="text-[12.5px] text-ink-muted">Turn on “Announcements digest” in Settings → Claude for a short write-up.</span>
            )}
          </div>
          {r?.digest && (
            <div className="mt-2 text-[14px]">
              <ChatMarkdown text={r.digest.text} openLink={(url) => void openExternal(url)} />
              <p className="mt-1 text-[12px] text-ink-muted">
                Written by Claude {timeAgo(r.digest.at)} from {r.digest.count} announcements. Check the filing before acting on anything.
              </p>
            </div>
          )}
        </section>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3 text-[13px]">
        <div role="radiogroup" aria-label="Whose announcements" className="flex rounded-sm border border-rule">
          {(
            [
              ['mine', 'Your companies'],
              ['market', 'Across the market']
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={scope === k}
              onClick={() => (setScope(k), setTag(null))}
              className={`px-3 py-1 ${scope === k ? 'bg-stamp text-black' : 'text-ink-muted hover:text-ink'}`}
            >
              {l}
            </button>
          ))}
        </div>
        {scope === 'mine' && (
          <label className="flex items-center gap-1.5 text-ink-muted">
            <input type="checkbox" checked={routine} onChange={(e) => setRoutine(e.target.checked)} /> Show routine filings
          </label>
        )}
      </div>
      <div role="radiogroup" aria-label="Kind of announcement" className="mb-4 flex flex-wrap gap-1 text-[12.5px]">
        <button type="button" role="radio" aria-checked={tag === null} onClick={() => setTag(null)} className={`rounded-sm px-2 py-0.5 ${tag === null ? 'bg-stamp-wash text-stamp' : 'text-ink-muted hover:text-ink'}`}>
          All
        </button>
        {ANN_TAGS.filter((t) => counts.get(t)).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={tag === t}
            onClick={() => setTag(t)}
            className={`rounded-sm px-2 py-0.5 ${tag === t ? 'bg-stamp-wash text-stamp' : 'text-ink-muted hover:text-ink'}`}
          >
            {ANN_TAG_LABEL[t]} <span className="num">{counts.get(t)}</span>
          </button>
        ))}
      </div>

      {q.isLoading && <p className="text-ink-muted">Opening the announcements…</p>}
      {r && list.length === 0 && (
        <p className="text-[13.5px] text-ink-muted">
          {r.updatedAt ? (scope === 'mine' ? 'Nothing from your companies in the last 30 days.' : 'Nothing of these kinds in the last three days.') : 'Waiting for the first download from NSE (Research must be on).'}
        </p>
      )}
      {days.map(([day, items]) => (
        <section key={day} className="mb-5">
          <h3 className="mb-1 border-b border-rule-strong pb-1 text-[13px] font-semibold text-ink-muted">
            {new Date(`${day}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
          </h3>
          <ul>
            {items.map((a) => (
              <li key={a.id} className="grid grid-cols-[52px_1fr] gap-x-3 border-b border-rule py-1.5 text-[13.5px] @2xl:grid-cols-[52px_220px_1fr]">
                <span className="num text-left text-[12px] text-ink-muted">{a.at.slice(11, 16)}</span>
                <span>
                  <button type="button" className="text-left font-medium hover:text-stamp hover:underline" onClick={() => open(a.symbol)}>
                    {a.symbol}
                  </button>
                  {a.held && <span className="ml-1.5 text-[11.5px] text-gain">held</span>}
                  <span className="block text-[12px] text-ink-muted">{ANN_TAG_LABEL[a.tag]}</span>
                </span>
                <span className="col-span-2 @2xl:col-span-1">
                  <span className="text-ink-muted">{a.category}. </span>
                  {a.text}{' '}
                  {a.url && (
                    <button type="button" className="text-[12px] text-stamp hover:underline" onClick={() => void openExternal(a.url!)}>
                      Filing
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}
