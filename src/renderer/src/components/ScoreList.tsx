import { useState } from 'react'
import type { Level, Tone } from '@shared/scorecard'

const LEVEL_CLS: Record<Tone, string> = {
  good: 'bg-gain/10 text-gain',
  bad: 'bg-loss/10 text-loss',
  neutral: 'bg-sheet text-ink-muted'
}

export interface ScoreItem {
  key: string
  title: string
  level: Level
  tone: Tone
  text: string
}

/** A scorecard: a line per card with its level as a coloured pill; click one for its sentence. */
export function ScoreList({ id, title = 'Scorecard', cards, note }: { id: string; title?: string; cards: ScoreItem[]; note: string }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section aria-labelledby={id} className="rounded-xl border border-rule">
      <h3 id={id} className="border-b border-rule px-5 py-3 text-[15px] font-semibold">
        {title}
      </h3>
      <ul>
        {cards.map((s) => (
          <li key={s.key} className="border-b border-rule last:border-0">
            <button
              type="button"
              aria-expanded={open === s.key}
              onClick={() => setOpen(open === s.key ? null : s.key)}
              className="flex w-full items-center gap-2 px-5 py-2.5 text-left hover:bg-sheet"
            >
              <span className="flex-1 text-[14px]">{s.title}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${LEVEL_CLS[s.tone]}`}>{s.level === 'None' ? 'n/a' : s.level}</span>
              <svg aria-hidden viewBox="0 0 12 12" className={'size-3 fill-none stroke-current text-ink-muted transition-transform ' + (open === s.key ? 'rotate-180' : '')} strokeWidth="1.6">
                <path d="m3 4.5 3 3 3-3" />
              </svg>
            </button>
            {open === s.key && <p className="px-5 pb-3 text-[13px] text-ink-muted">{s.text}</p>}
          </li>
        ))}
      </ul>
      <p className="border-t border-rule px-5 py-2.5 text-[11.5px] text-ink-muted">{note}</p>
    </section>
  )
}
