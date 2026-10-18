import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ChatEvent, ChatTurn } from '@shared/ai'
import { ChatMarkdown } from '../../../src/renderer/src/lib/markdown'
import { askOnPhone } from '../lib/ask'
import { useData } from '../lib/data'

const EXAMPLES = [
  'How much did we make this financial year?',
  'How much long-term gain can I still book tax-free?',
  'Where did my card money go last month?',
  'Which bills and renewals are due this month?',
  'Dad ke paas kitna equity hai?'
]

/** Ask your money, full screen on the phone. */
export function Ask({ onClose }: { onClose: () => void }) {
  const { snapshot } = useData()
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [looking, setLooking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)

  // Braces matter: scrollIntoView returns a promise in newer browsers, and React would take it for a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [turns, looking])

  if (!snapshot) return null

  const onEvent = (e: ChatEvent) => {
    if (e.type === 'text')
      setTurns((t) => {
        const last = t[t.length - 1]
        return last?.role === 'assistant' ? [...t.slice(0, -1), { ...last, text: last.text + e.text }] : [...t, { role: 'assistant', text: e.text }]
      })
    else if (e.type === 'looking') setLooking(e.what)
    else if (e.type === 'done')
      setTurns((t) => {
        const last = t[t.length - 1]
        return last?.role === 'assistant' ? [...t.slice(0, -1), { ...last, looked: e.looked }] : t
      })
    else if (e.type === 'error') setError(e.message)
  }

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || busy) return
    const history: ChatTurn[] = [...turns.filter((t) => t.text), { role: 'user', text: q }]
    setTurns(history)
    setDraft('')
    setError(null)
    setBusy(true)
    try {
      await askOnPhone(snapshot, history, onEvent, crypto.randomUUID())
    } finally {
      setBusy(false)
      setLooking(null)
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void send(draft)
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Ask your money" className="fixed inset-0 z-50 flex flex-col bg-paper" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="flex items-center justify-between border-b border-rule px-4 py-2">
        <h2 className="wide text-[20px] font-semibold">Ask your money</h2>
        <div className="flex gap-1">
          {turns.length > 0 && (
            <button className="min-h-10 rounded-full px-3 text-[14px] text-ink-muted" onClick={() => setTurns([])} disabled={busy}>
              New chat
            </button>
          )}
          <button className="min-h-10 rounded-full px-3 text-[15px] font-medium text-stamp" onClick={onClose}>
            Done
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {turns.length === 0 && (
          <div className="text-[15px] text-ink-muted">
            <p className="mb-3">
              Ask about your money in English or Hinglish. Answers come from the figures synced from the computer
              {snapshot.pricesAsOf ? ` (prices as of ${new Date(snapshot.pricesAsOf).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })})` : ''}. It
              explains, and won&rsquo;t tell you what to buy or sell.
            </p>
            <ul className="flex flex-col gap-2">
              {EXAMPLES.map((x) => (
                <li key={x}>
                  <button className="min-h-11 w-full rounded-xl border border-rule-strong px-3 py-2 text-left text-ink" onClick={() => void send(x)}>
                    {x}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`mb-3 ${t.role === 'user' ? 'flex justify-end' : ''}`}>
            {t.role === 'user' ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-stamp px-3 py-2 text-[15px] whitespace-pre-wrap text-white dark:text-[#10162a]">{t.text}</div>
            ) : (
              <div className="text-[15px] leading-relaxed">
                <ChatMarkdown text={t.text} openLink={(url) => window.open(url, '_blank', 'noopener')} />
              </div>
            )}
            {t.looked && t.looked.length > 0 && <div className="mt-1 text-[12px] text-ink-muted">Looked at: {t.looked.join(', ')}</div>}
          </div>
        ))}
        {busy && (
          <p className="text-[14px] text-ink-muted" aria-live="polite">
            {looking ? `Looking at ${looking}…` : 'Thinking…'}
          </p>
        )}
        {error && <p className="mt-2 text-[15px] text-loss">{error}</p>}
        <div ref={end} />
      </div>

      <form onSubmit={submit} className="safe-bottom border-t border-rule bg-sheet px-3 pt-2">
        <div className="flex items-end gap-2">
          <textarea
            aria-label="Your question"
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask in English or Hinglish…"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-rule-strong bg-paper px-3 py-2.5 text-[16px]"
          />
          <button type="submit" disabled={!draft.trim() || busy} className="min-h-11 rounded-xl bg-stamp px-4 font-semibold text-white disabled:opacity-50 dark:text-[#10162a]">
            Ask
          </button>
        </div>
        <p className="py-1 text-[11px] text-ink-muted">Sends your question and the figures it looks up to Anthropic.</p>
      </form>
    </div>
  )
}
