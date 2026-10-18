import { useEffect, useRef, useState, type FormEvent } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatTurn } from '@shared/ai'
import { askMoney, onChatEvent, openExternal, useAiStatus, useSetAiFeatures, useSetAiKey } from '../lib/api'

// Claude's answers are markdown. Raw HTML in them is not rendered (react-markdown's default), and
// links open in the browser rather than inside the app.
const MD: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  h1: ({ children }) => <h3 className="mt-3 mb-1.5 text-[15px] font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-3 mb-1.5 text-[15px] font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1 text-[14px] font-semibold">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-2 mb-1 text-[14px] font-semibold">{children}</h4>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-stamp underline"
      onClick={(e) => {
        e.preventDefault()
        if (href && /^https?:\/\//i.test(href)) void openExternal(href)
      }}
    >
      {children}
    </a>
  ),
  code: ({ children }) => <code className="rounded bg-sheet px-1 py-0.5 text-[13px]">{children}</code>,
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-md bg-sheet p-2 text-[13px]">{children}</pre>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-rule-strong pl-3 text-ink-muted">{children}</blockquote>,
  hr: () => <hr className="my-3 border-rule" />,
  // Never load images from an answer: text from an email could plant one whose address carries
  // figures to someone else's server. Show its description instead.
  img: ({ alt }) => (alt ? <span className="text-ink-muted">[{alt}]</span> : null),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="num w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="border-b border-rule-strong px-2 py-1 text-left font-semibold whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-b border-rule px-2 py-1 align-top">
      {children}
    </td>
  )
}

const OPEN_EVENT = 'fp:open-ask'
/** Opens the chat from anywhere (the sidebar button). */
export const openAsk = () => window.dispatchEvent(new Event(OPEN_EVENT))

/** Shown in the chat until it can answer: the key, then the switches, without leaving the page. */
function ChatSetup({ hasKey }: { hasKey: boolean }) {
  const setKey = useSetAiKey()
  const features = useSetAiFeatures()
  const [key, setKeyText] = useState('')
  const [gmail, setGmail] = useState(true)
  const error = setKey.error ?? features.error
  return (
    <div className="text-[14px]">
      <p className="mb-3">
        This chat answers from your app&rsquo;s figures, live NSE/BSE prices and mutual fund data
        {gmail ? ', and can search your connected Gmail' : ''}. It runs on Claude with your own API key, billed by
        Anthropic (roughly US$0.05–0.20 a question).
      </p>
      {!hasKey ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setKey.mutate([key.trim()], {
              onSuccess: () => features.mutate([{ chat: true, chatMail: gmail }])
            })
          }}
          className="flex flex-col gap-2"
        >
          <label className="text-[13px] font-medium" htmlFor="ask-key">
            Claude API key (starts with sk-ant-)
          </label>
          <input
            id="ask-key"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKeyText(e.target.value)}
            className="rounded-md border border-rule-strong bg-sheet px-3 py-2"
          />
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={gmail} onChange={(e) => setGmail(e.target.checked)} />
            Also let it search my Gmail (sends the emails it opens to Anthropic)
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!key.trim() || setKey.isPending}
              className="rounded-md bg-stamp px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:text-[#10162a]"
            >
              {setKey.isPending ? 'Checking…' : 'Save key and start'}
            </button>
            <button
              type="button"
              className="text-[13px] text-stamp hover:underline"
              onClick={() => void openExternal('https://platform.claude.com/settings/keys')}
            >
              Get a key
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={gmail} onChange={(e) => setGmail(e.target.checked)} />
            Also let it search my Gmail (sends the emails it opens to Anthropic)
          </label>
          <button
            onClick={() => features.mutate([{ chat: true, chatMail: gmail }])}
            disabled={features.isPending}
            className="self-start rounded-md bg-stamp px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:text-[#10162a]"
          >
            Turn on Ask your money
          </button>
        </div>
      )}
      <p className="mt-3 text-[12px] text-ink-muted">
        The key is stored encrypted on this computer. Change these any time in Settings → Claude.
      </p>
      {error && <p className="mt-2 text-loss">{error instanceof Error ? error.message : String(error)}</p>}
    </div>
  )
}

const EXAMPLES = [
  'How much did I put into mutual funds this financial year?',
  'How much long-term gain can I book tax-free this year?',
  'How has Nifty 50 done this year, and where is it against its 52-week high?',
  'Compare the expense ratio and 5-year return of my flexi cap fund with Parag Parikh Flexi Cap',
  'Dad ke paas kitna equity hai?'
]
const MAIL_EXAMPLES = [
  'Find my latest Zerodha tradebook in Gmail and import it',
  'Which dividends were credited last month, from my emails?'
]

/** "Ask your money": a side panel (or the full window) on every page; it sets itself up on first open. */
export function AskPanel() {
  const ai = useAiStatus().data
  const [open, setOpen] = useState(false)
  const [wide, setWide] = useState(false)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [looking, setLooking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = useRef<string | null>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(
    () =>
      onChatEvent((e) => {
        if (e.id !== current.current) return
        if (e.type === 'text')
          setTurns((t) => {
            const last = t[t.length - 1]
            return last?.role === 'assistant'
              ? [...t.slice(0, -1), { ...last, text: last.text + e.text }]
              : [...t, { role: 'assistant', text: e.text }]
          })
        else if (e.type === 'looking') setLooking(e.what)
        else if (e.type === 'done') {
          setTurns((t) => {
            const last = t[t.length - 1]
            return last?.role === 'assistant' ? [...t.slice(0, -1), { ...last, looked: e.looked }] : t
          })
          setLooking(null)
        } else if (e.type === 'error') {
          setError(e.message)
          setLooking(null)
        }
      }),
    []
  )
  // Braces matter: scrollIntoView returns a promise in newer Chromium, and React would take it for a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [turns, looking])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(OPEN_EVENT, onOpen)
    }
  }, [])

  if (!ai) return null
  const ready = ai.hasKey && ai.chat

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || busy) return
    const history: ChatTurn[] = [...turns.filter((t) => t.text), { role: 'user', text: q }]
    setTurns(history)
    setDraft('')
    setError(null)
    setBusy(true)
    const id = crypto.randomUUID()
    current.current = id
    try {
      await askMoney(id, history)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed right-6 bottom-6 z-40 rounded-full bg-stamp px-5 py-3 text-[15px] font-semibold text-white shadow-lg hover:brightness-110 dark:text-[#10162a]"
        >
          Ask your money
        </button>
      )}
      {open && (
        <aside
          aria-label="Ask your money"
          className={`fixed top-0 right-0 bottom-0 z-40 flex flex-col border-l border-rule-strong bg-paper shadow-2xl ${wide ? 'left-60' : 'w-[min(460px,100vw)]'}`}
        >
          <div className="flex items-center justify-between border-b border-rule px-4 py-3">
            <h2 className="text-[16px] font-semibold">Ask your money</h2>
            <div className="flex gap-3 text-[13px]">
              <button className="text-ink-muted hover:text-ink" onClick={() => setWide((w) => !w)}>
                {wide ? 'Side panel' : 'Full window'}
              </button>
              {turns.length > 0 && (
                <button className="text-ink-muted hover:text-ink" onClick={() => setTurns([])} disabled={busy}>
                  New chat
                </button>
              )}
              <button className="text-stamp hover:underline" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
          <div className={`flex-1 overflow-y-auto py-3 ${wide ? 'px-[max(1rem,calc((100%-760px)/2))]' : 'px-4'}`}>
            {!ready && <ChatSetup hasKey={ai.hasKey} />}
            {ready && turns.length === 0 && (
              <div className="text-[14px] text-ink-muted">
                <p className="mb-3">
                  Ask about your holdings, tax, returns, spending, property, vehicles or the forecast, any stock, index
                  or mutual fund{ai.chatMail ? ', or what is in your Gmail' : ''}. Answers come from the app&rsquo;s own
                  figures and live market data; it explains, and won&rsquo;t tell you what to buy or sell.
                </p>
                <ul className="flex flex-col gap-2">
                  {[...EXAMPLES, ...(ai.chatMail ? MAIL_EXAMPLES : [])].map((x) => (
                    <li key={x}>
                      <button
                        className="rounded-md border border-rule-strong px-3 py-1.5 text-left text-ink hover:bg-sheet"
                        onClick={() => void send(x)}
                      >
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
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-stamp px-3 py-2 text-[14px] whitespace-pre-wrap text-white dark:text-[#10162a]">
                    {t.text}
                  </div>
                ) : (
                  <div className="text-[14px] leading-relaxed">
                    <Markdown remarkPlugins={[remarkGfm]} components={MD}>
                      {t.text}
                    </Markdown>
                  </div>
                )}
                {t.looked && t.looked.length > 0 && (
                  <div className="mt-1 text-[12px] text-ink-muted">Looked at: {t.looked.join(', ')}</div>
                )}
              </div>
            ))}
            {busy && (
              <p className="text-[13px] text-ink-muted" aria-live="polite">
                {looking ? `Looking at ${looking}…` : 'Thinking…'}
              </p>
            )}
            {error && <p className="mt-2 text-[14px] text-loss">{error}</p>}
            <div ref={end} />
          </div>
          {ready && (
            <form
              onSubmit={submit}
              className={`border-t border-rule py-3 ${wide ? 'px-[max(0.75rem,calc((100%-760px)/2))]' : 'px-3'}`}
            >
              <textarea
                aria-label="Your question"
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send(draft)
                  }
                }}
                placeholder="Ask in English or Hinglish…"
                className="w-full resize-none rounded-md border border-rule-strong bg-sheet px-3 py-2 text-[14px]"
              />
              <div className="mt-1 flex items-center justify-between text-[12px] text-ink-muted">
                <span>
                  Sends your question and what it looks up{ai.chatMail ? ' (figures, emails)' : ''} to Anthropic.
                </span>
                <button
                  type="submit"
                  disabled={!draft.trim() || busy}
                  className="rounded-md bg-stamp px-3 py-1 font-medium text-white disabled:opacity-50 dark:text-[#10162a]"
                >
                  Ask
                </button>
              </div>
            </form>
          )}
        </aside>
      )}
    </>
  )
}
