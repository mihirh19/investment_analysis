import { useState } from 'react'
import { ErrorNote } from './Shell'
import { Button, Field, Input } from './ui'
import {
  openExternal,
  useAiStatus,
  useForgetPdfPasswords,
  usePdfPasswordCount,
  useRemoveAiKey,
  useSetAiFeatures,
  useSetAiKey
} from '../lib/api'

const CONSOLE_KEYS = 'https://platform.claude.com/settings/keys'

function Toggle({
  on,
  disabled,
  onChange,
  title,
  sends,
  children
}: {
  on: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
  title: string
  sends: string
  children: React.ReactNode
}) {
  return (
    <label className={`flex gap-3 rounded-md border p-3 ${on ? 'border-stamp bg-stamp-wash' : 'border-rule-strong'} ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <input type="checkbox" className="mt-1 h-4 w-4" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-[14px]">
        <span className="block font-medium">{title}</span>
        <span className="block text-ink-muted">{children}</span>
        <span className="mt-1 block text-[13px] text-ink-muted">
          <b className="font-medium text-ink">Sends to Anthropic:</b> {sends}
        </span>
      </span>
    </label>
  )
}

/** Settings section: the person's own Claude API key and what may use it. */
export function ClaudeSettings() {
  const q = useAiStatus()
  const setKey = useSetAiKey()
  const remove = useRemoveAiKey()
  const features = useSetAiFeatures()
  const pdf = usePdfPasswordCount()
  const forget = useForgetPdfPasswords()
  const [key, setKeyText] = useState('')
  const s = q.data
  if (!s) return null
  return (
    <section aria-labelledby="claude" className="mb-12 max-w-[880px]">
      <h2 id="claude" className="wide mb-2 text-[19px] font-semibold">
        Claude
      </h2>
      <p className="mb-4 max-w-[72ch] text-[14px] text-ink-muted">
        With your own Claude API key the app can read card and bank statements from any bank, and answer questions about
        your money. Everything else stays on this computer: each switch below says exactly what it sends. Anthropic bills
        your key directly.
      </p>

      {!s.hasKey ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            setKey.mutate([key], { onSuccess: () => setKeyText('') })
          }}
        >
          <Field label="API key" hint="From the Claude Console → API keys; it starts with sk-ant-">
            <Input type="password" className="w-96" value={key} onChange={(e) => setKeyText(e.target.value)} autoComplete="off" />
          </Field>
          <Button type="submit" disabled={!key || setKey.isPending}>
            {setKey.isPending ? 'Checking…' : 'Save key'}
          </Button>
          <button type="button" className="mb-2 text-[13px] text-stamp hover:underline" onClick={() => void openExternal(CONSOLE_KEYS)}>
            Get a key
          </button>
        </form>
      ) : (
        <div className="mb-4 flex flex-wrap items-center gap-4 text-[14px]">
          <span>
            Key ending <b className="num">…{s.keyEnding}</b>, model {s.model}
          </span>
          <span className="text-ink-muted">
            This month: {s.month.calls} request{s.month.calls === 1 ? '' : 's'}, about US${s.month.costUsd.toFixed(2)}
          </span>
          <Button variant="danger" onClick={() => confirm('Remove the key and switch Claude off?') && remove.mutate([])}>
            Remove key
          </Button>
        </div>
      )}

      <div className="mt-3 grid gap-3 @3xl:grid-cols-2">
        <Toggle
          on={s.statements}
          disabled={!s.hasKey}
          onChange={(v) => features.mutate([{ statements: v }])}
          title="Read statements"
          sends="the text of each statement you add (or that arrives in a connected Gmail): transactions, amounts, the last 4 digits and your name as printed."
        >
          Card and bank statements and Zerodha contract notes become transactions and spending (Spending page). With Gmail
          connected, new ones are read as they arrive. Roughly US$0.10–0.25 a statement.
        </Toggle>
        <Toggle
          on={s.chat}
          disabled={!s.hasKey}
          onChange={(v) => features.mutate([{ chat: v }])}
          title="Ask your money"
          sends="your question and the figures it looks up to answer (holdings, tax, spending… as on the pages), for that question only."
        >
          Ask in plain words, in English or Hinglish. It answers from the app&rsquo;s own figures and live market data
          (any NSE/BSE stock or index, any mutual fund&rsquo;s returns, costs and NAV history, inflation) and explains;
          it never tells you what to buy or sell. Roughly US$0.05–0.20 a question.
        </Toggle>
        <Toggle
          on={s.chatMail}
          disabled={!s.hasKey || !s.chat}
          onChange={(v) => features.mutate([{ chatMail: v }])}
          title="Search my Gmail"
          sends="the subject, sender, preview and text of emails it searches for or opens to answer that question."
        >
          Lets Ask your money search the connected Gmail accounts (read-only) for what you ask about: a broker or bank
          email, a dividend or SIP confirmation, a renewal, a bill. It can import an email&rsquo;s statement or report
          when you ask it to.
        </Toggle>
        <Toggle
          on={s.phoneChat}
          disabled={!s.hasKey || !s.chat}
          onChange={(v) => features.mutate([{ phoneChat: v }])}
          title="Ask your money on the phone"
          sends="from the phone, your question and the synced figures it looks up. Your key goes to the phone inside the copy locked with your phone passphrase, in your own Drive."
        >
          The phone app gets an Ask button that answers from its synced figures (and any fund&rsquo;s NAV history). Turn
          this off, or remove the key, and the next sync takes the key off the phone. Needs the phone app set up.
        </Toggle>
        <Toggle
          on={s.marketNotes}
          disabled={!s.hasKey}
          onChange={(v) => features.mutate([{ marketNotes: v }])}
          title="Market notes for the farm"
          sends="the crop, the mandi and its public prices (today’s, averages, MSP, past seasons); never your stock, sales or money. Claude searches the web for news."
        >
          On the Farm page, a note on what is moving a crop&rsquo;s price (sowing and crop estimates, weather,
          government buying, demand) with a likely range for the next 1–3 months and its sources. An outlook, not a
          promise; at most one a day per crop, roughly US$0.10–0.30 each.
        </Toggle>
        <Toggle
          on={s.newsDigest}
          disabled={!s.hasKey}
          onChange={(v) => features.mutate([{ newsDigest: v }])}
          title="Announcements digest"
          sends="the last few days’ exchange announcements of your held and watched companies (company, date, kind and NSE’s summary line), which shows which companies you follow; never amounts or holdings."
        >
          On Research → Announcements, a short write-up of which announcements matter and why. Written only when you
          press the button; roughly US$0.02–0.05 each.
        </Toggle>
      </div>
      {(pdf.data ?? 0) > 0 && (
        <p className="mt-3 text-[13px] text-ink-muted">
          {pdf.data} statement PDF password{pdf.data === 1 ? '' : 's'} remembered (encrypted).{' '}
          <button className="text-stamp hover:underline" onClick={() => confirm('Forget the saved PDF passwords?') && forget.mutate([])}>
            Forget them
          </button>
        </p>
      )}
      <ErrorNote error={setKey.error ?? features.error ?? remove.error} />
    </section>
  )
}
