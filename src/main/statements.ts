import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import { z } from 'zod'
import {
  NOT_SPENDING,
  SPEND_CATEGORIES,
  type SpendCategory,
  type SpendingReport,
  type StatementImportResult,
  type StatementRead,
  type StatementView
} from '@shared/ai'
import { AI_MODEL, FALLBACK_BETA } from './ai'
import { schema, type Db } from './db'
import { CasHelperError } from './importers/cas'

/**
 * Card and bank statements (and broker contract notes) from any bank, read by Claude. The PDF's
 * text is taken out here first (with the saved PDF passwords), so only text goes to Anthropic;
 * Claude returns the statement in a fixed shape that is checked before anything is saved. The
 * same statement read twice (by hand and from Gmail) is recognised and skipped.
 */

const day = z.string().describe('Date as YYYY-MM-DD')
const maybeDay = day.nullable()
const money = z.number().nullable()

export const StatementSchema = z.object({
  kind: z.enum(['CREDIT_CARD', 'BANK_ACCOUNT', 'CONTRACT_NOTE', 'OTHER']),
  institution: z.string().describe('Bank, card issuer or broker, short: "HDFC Bank", "SBI Card", "Zerodha"'),
  accountName: z.string().describe('The card or account as named on the statement, e.g. "Millennia Credit Card", "Savings Account"'),
  last4: z.string().nullable().describe('Last 4 digits of the card or account number; never more'),
  holderName: z.string().nullable(),
  periodFrom: maybeDay,
  periodTo: maybeDay,
  statementDate: maybeDay,
  dueDate: maybeDay.describe('Payment due date (cards)'),
  totalDue: money.describe('Total amount due (cards), rupees'),
  minimumDue: money,
  creditLimit: money,
  openingBalance: money,
  closingBalance: money,
  rewardPoints: money,
  transactions: z.array(
    z.object({
      date: day,
      description: z.string().describe('As printed'),
      merchant: z.string().nullable().describe('The shop, company or person, cleaned up, when clear'),
      amount: z.number().describe('Rupees, always positive'),
      direction: z.enum(['DEBIT', 'CREDIT']).describe('DEBIT: money out (a purchase, a withdrawal). CREDIT: money in (a payment to the card, a refund, a deposit)'),
      category: z.enum(SPEND_CATEGORIES),
      isEmi: z.boolean()
    })
  ),
  trades: z.array(
    z.object({
      date: day,
      symbol: z.string().describe('NSE/BSE symbol or the security name as printed'),
      isin: z.string().nullable(),
      side: z.enum(['BUY', 'SELL']),
      quantity: z.number(),
      price: z.number().describe('Price per unit before brokerage'),
      exchange: z.string().nullable(),
      tradeId: z.string().nullable().describe('Trade number as printed')
    })
  )
})

const SYSTEM = `You read Indian credit card statements, bank account statements and stockbroker contract notes, and return what they say in the given JSON shape.

Rules:
- Copy figures exactly as printed. Never estimate, total up or invent a value: use null for anything not printed.
- Dates as YYYY-MM-DD. Indian statements print dates day first (05/04/2026 is 5 April 2026).
- Amounts in rupees as positive numbers; the direction says which way the money went. On a card, purchases, fees, interest and EMIs are DEBIT; payments to the card, refunds and cashback are CREDIT. In a bank account, withdrawals and payments out are DEBIT; deposits, salary and interest are CREDIT.
- Include every transaction line, in the order printed. Skip opening/closing balance lines, sub-totals and summary rows.
- Categories: a card bill paid from a bank account is CARD_PAYMENT; a payment received on a card is CARD_PAYMENT too. Moves between the holder's own accounts are TRANSFER. Mutual fund SIPs, broker and NPS payments are INVESTMENT. Loan and card EMIs are EMI_LOAN with isEmi true. A UPI payment to a person with no other clue is OTHER, not TRANSFER.
- For a contract note, list each trade (not the summary) with its trade number; leave transactions empty.
- last4 is at most the last 4 digits of a card or account number.`

/** Every page's text; tries no password, then each saved one. Throws when none opens it. */
export async function statementText(
  readPdf: (path: string, password: string) => Promise<string[]>,
  filePath: string,
  passwords: string[]
): Promise<{ pages: string[]; password: string }> {
  let lastError: unknown = null
  for (const password of ['', ...passwords]) {
    try {
      return { pages: await readPdf(filePath, password), password }
    } catch (e) {
      if (e instanceof CasHelperError && e.code === 'wrong_password') {
        lastError = e
        continue
      }
      throw e
    }
  }
  throw lastError ?? new Error('Could not open the PDF')
}

export class PdfPasswordNeeded extends Error {
  constructor() {
    super('This PDF has a password none of the saved ones open. Enter it, and it is kept for this sender’s next statements.')
  }
}

/** Asks Claude to read a statement. Returns the checked result and records the token use. */
export async function readStatement(
  client: Anthropic,
  content: { text: string } | { pdf: Buffer },
  record: (u: Anthropic.Beta.BetaUsage) => void
): Promise<StatementRead> {
  const stream = client.beta.messages.stream({
    model: AI_MODEL,
    max_tokens: 64000,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(StatementSchema) },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content:
          'text' in content
            ? `The statement's text, page by page:\n\n${content.text}`
            : [
                {
                  type: 'document',
                  source: { type: 'base64', media_type: 'application/pdf', data: content.pdf.toString('base64') }
                },
                { type: 'text', text: 'Read this statement.' }
              ]
      }
    ]
  })
  const msg = await stream.finalMessage()
  record(msg.usage)
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined to read this document.')
  if (msg.stop_reason === 'max_tokens') throw new Error('The statement is too long to read in one go.')
  const text = msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const parsed = StatementSchema.safeParse(JSON.parse(text))
  if (!parsed.success) throw new Error('Claude’s reading of the statement didn’t check out; try again.')
  return parsed.data
}

/** One file to text-or-PDF content for Claude: text when the PDF has a text layer. */
export async function statementContent(
  readPdf: (path: string, password: string) => Promise<string[]>,
  filePath: string,
  passwords: string[]
): Promise<{ content: { text: string } | { pdf: Buffer }; password: string }> {
  let opened: { pages: string[]; password: string }
  try {
    opened = await statementText(readPdf, filePath, passwords)
  } catch (e) {
    if (e instanceof CasHelperError && e.code === 'wrong_password') throw new PdfPasswordNeeded()
    throw e
  }
  const text = opened.pages.map((p, i) => `--- Page ${i + 1} ---\n${p}`).join('\n\n')
  // A scan has no text layer: send the PDF itself (only possible when it isn't locked).
  if (text.replace(/--- Page \d+ ---|\s/g, '').length < 200) {
    if (opened.password) throw new Error('This is a scanned, password-protected PDF; save an unlocked copy and add that.')
    return { content: { pdf: readFileSync(filePath) }, password: '' }
  }
  return { content: { text }, password: opened.password }
}

/** Saves a read statement for a person. Contract-note trades go to `importTrades`. */
export function saveStatement(
  db: Db,
  personId: number,
  r: StatementRead,
  source: string,
  importTrades?: (r: StatementRead) => number
): StatementImportResult {
  const label = `${r.institution} ${r.accountName}${r.last4 ? ` ••${r.last4}` : ''}`
  if (r.kind === 'CONTRACT_NOTE') {
    const n = importTrades && r.trades.length ? importTrades(r) : 0
    return {
      statementId: null,
      account: label,
      kind: r.kind,
      transactions: 0,
      trades: n,
      duplicate: false,
      message: n ? `${n} trade${n > 1 ? 's' : ''} added to your trade history.` : 'No new trades.'
    }
  }
  if (r.kind === 'OTHER') return { statementId: null, account: label, kind: r.kind, transactions: 0, trades: 0, duplicate: false, message: 'Not a card or bank statement.' }

  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        personId,
        r.kind,
        r.institution.toLowerCase(),
        r.last4,
        r.periodTo ?? r.statementDate,
        r.totalDue ?? r.closingBalance,
        r.transactions.length
      ])
    )
    .digest('hex')
  if (db.select().from(schema.statements).where(eq(schema.statements.fingerprint, fingerprint)).get())
    return { statementId: null, account: label, kind: r.kind, transactions: 0, trades: 0, duplicate: true, message: 'Already read.' }

  return db.transaction((tx) => {
    const sameInstitution = (a: { institution: string }) => a.institution.toLowerCase() === r.institution.toLowerCase()
    let account = tx
      .select()
      .from(schema.spendAccounts)
      .where(and(eq(schema.spendAccounts.personId, personId), eq(schema.spendAccounts.kind, r.kind as 'CREDIT_CARD' | 'BANK_ACCOUNT')))
      .all()
      .find((a) => sameInstitution(a) && (a.last4 ?? '') === (r.last4 ?? ''))
    account ??= tx
      .insert(schema.spendAccounts)
      .values({ personId, kind: r.kind as 'CREDIT_CARD' | 'BANK_ACCOUNT', institution: r.institution, name: r.accountName, last4: r.last4 })
      .returning()
      .get()
    const st = tx
      .insert(schema.statements)
      .values({
        accountId: account.id,
        periodFrom: r.periodFrom,
        periodTo: r.periodTo,
        statementDate: r.statementDate,
        dueDate: r.dueDate,
        totalDue: r.totalDue,
        minimumDue: r.minimumDue,
        creditLimit: r.creditLimit,
        openingBalance: r.openingBalance,
        closingBalance: r.closingBalance,
        rewardPoints: r.rewardPoints,
        source,
        fingerprint
      })
      .returning()
      .get()
    for (const t of r.transactions)
      tx.insert(schema.spendTxns)
        .values({
          accountId: account.id,
          statementId: st.id,
          date: t.date,
          description: t.description,
          merchant: t.merchant,
          amount: t.direction === 'DEBIT' ? Math.abs(t.amount) : -Math.abs(t.amount),
          category: t.category,
          isEmi: t.isEmi
        })
        .run()
    return {
      statementId: st.id,
      account: label,
      kind: r.kind,
      transactions: r.transactions.length,
      trades: 0,
      duplicate: false,
      message: `${r.transactions.length} transaction${r.transactions.length === 1 ? '' : 's'} read.`
    }
  })
}

export function setCategory(db: Db, txnId: number, category: SpendCategory): void {
  if (!SPEND_CATEGORIES.includes(category)) throw new Error('Unknown category')
  db.update(schema.spendTxns).set({ category, edited: true }).where(eq(schema.spendTxns.id, txnId)).run()
}

export function deleteStatement(db: Db, id: number): void {
  db.transaction((tx) => {
    tx.delete(schema.spendTxns).where(eq(schema.spendTxns.statementId, id)).run()
    tx.delete(schema.statements).where(eq(schema.statements.id, id)).run()
  })
}

/** Spending by month and category, card dues and the transactions behind them. */
export function spendingReport(db: Db, personId?: number, monthsBack = 12, today = new Date().toISOString().slice(0, 10)): SpendingReport {
  const names = new Map(db.select().from(schema.persons).all().map((p) => [p.id, p.name]))
  const accounts = db
    .select()
    .from(schema.spendAccounts)
    .all()
    .filter((a) => personId === undefined || a.personId === personId)
  const ids = accounts.map((a) => a.id)
  const since = (() => {
    const d = new Date(`${today}T00:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() - monthsBack + 1, 1)
    return d.toISOString().slice(0, 10)
  })()
  const txns = ids.length
    ? db
        .select()
        .from(schema.spendTxns)
        .where(and(inArray(schema.spendTxns.accountId, ids), gte(schema.spendTxns.date, since)))
        .orderBy(desc(schema.spendTxns.date))
        .all()
    : []
  const stmts = ids.length
    ? db.select().from(schema.statements).where(inArray(schema.statements.accountId, ids)).orderBy(desc(schema.statements.statementDate)).all()
    : []
  const counts = new Map<number, number>()
  for (const t of txns) counts.set(t.statementId, (counts.get(t.statementId) ?? 0) + 1)
  const allTxns = ids.length ? db.select().from(schema.spendTxns).where(inArray(schema.spendTxns.accountId, ids)).all() : []

  /** A card bill counts as paid once a payment of at least the total due shows up after the statement. */
  const paidOf = (s: (typeof stmts)[number]): boolean | null => {
    const acct = accounts.find((a) => a.id === s.accountId)
    if (acct?.kind !== 'CREDIT_CARD' || s.totalDue === null) return null
    if (s.totalDue <= 0) return true
    const after = s.statementDate ?? s.periodTo ?? ''
    const onCard = allTxns.some(
      (t) => t.accountId === s.accountId && t.date > after && t.amount < 0 && t.category === 'CARD_PAYMENT' && -t.amount >= s.totalDue! * 0.99
    )
    const fromBank = allTxns.some(
      (t) =>
        accounts.find((a) => a.id === t.accountId)?.kind === 'BANK_ACCOUNT' &&
        t.category === 'CARD_PAYMENT' &&
        t.date >= after &&
        Math.abs(t.amount - s.totalDue!) <= Math.max(1, s.totalDue! * 0.01)
    )
    return onCard || fromBank
  }
  const view = (s: (typeof stmts)[number]): StatementView => ({
    id: s.id,
    accountId: s.accountId,
    periodFrom: s.periodFrom,
    periodTo: s.periodTo,
    statementDate: s.statementDate,
    dueDate: s.dueDate,
    totalDue: s.totalDue,
    minimumDue: s.minimumDue,
    creditLimit: s.creditLimit,
    closingBalance: s.closingBalance,
    rewardPoints: s.rewardPoints,
    transactions: counts.get(s.id) ?? 0,
    source: s.source.startsWith('gmail:') ? 'Gmail' : s.source,
    addedAt: s.createdAt,
    paid: paidOf(s)
  })

  const months: string[] = []
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(`${today}T00:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() - i, 1)
    months.push(d.toISOString().slice(0, 7))
  }
  const byMonth = months.map((month) => {
    const byCategory: Partial<Record<SpendCategory, number>> = {}
    let total = 0
    for (const t of txns) {
      if (!t.date.startsWith(month) || t.amount <= 0 || NOT_SPENDING.includes(t.category as SpendCategory)) continue
      byCategory[t.category as SpendCategory] = (byCategory[t.category as SpendCategory] ?? 0) + t.amount
      total += t.amount
    }
    return { month, total, byCategory }
  })

  const dues = accounts
    .filter((a) => a.kind === 'CREDIT_CARD')
    .map((a) => stmts.find((s) => s.accountId === a.id))
    .filter((s): s is (typeof stmts)[number] => !!s && !!s.dueDate && (s.totalDue ?? 0) > 0 && paidOf(s) === false)
    .map((s) => {
      const a = accounts.find((x) => x.id === s.accountId)!
      return { accountId: a.id, name: `${a.institution} ${a.name}${a.last4 ? ` ••${a.last4}` : ''}`, dueDate: s.dueDate!, totalDue: s.totalDue!, minimumDue: s.minimumDue }
    })
    .sort((x, y) => x.dueDate.localeCompare(y.dueDate))

  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      personId: a.personId,
      personName: names.get(a.personId) ?? '',
      kind: a.kind,
      institution: a.institution,
      name: a.name,
      last4: a.last4,
      latest: (() => {
        const s = stmts.find((x) => x.accountId === a.id)
        return s ? view(s) : null
      })()
    })),
    months,
    byMonth,
    dues,
    transactions: txns.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      statementId: t.statementId,
      date: t.date,
      description: t.description,
      merchant: t.merchant,
      amount: t.amount,
      category: t.category as SpendCategory,
      edited: t.edited,
      isEmi: t.isEmi
    }))
  }
}
