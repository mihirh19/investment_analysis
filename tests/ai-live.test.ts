// Reads a made-up card statement with the real Claude API:
//   ANTHROPIC_API_KEY=sk-ant-… npx vitest run tests/ai-live.test.ts
import Anthropic from '@anthropic-ai/sdk'
import { expect, it } from 'vitest'
import { readStatement } from '../src/main/statements'

const TEXT = `--- Page 1 ---
HDFC Bank Millennia Credit Card Statement
Card No: 5432 XXXX XXXX 4321    Name: MIHIR SAMPLE
Statement Date: 20/09/2026    Billing Period: 21/08/2026 - 20/09/2026
Payment Due Date: 10/10/2026
Total Amount Due: 5,450.00    Minimum Amount Due: 280.00    Credit Limit: 2,00,000
Date        Transaction Description                 Amount (Rs.)
25/08/2026  SWIGGY BANGALORE                        650.00
02/09/2026  HPCL FUEL STATION AHMEDABAD             3,000.00
05/09/2026  PAYMENT RECEIVED - THANK YOU            9,000.00 Cr
10/09/2026  AMAZON PAY INDIA                        1,800.00
Reward Points Balance: 1,200`

it.runIf(process.env.ANTHROPIC_API_KEY)(
  'reads a card statement',
  async () => {
    const r = await readStatement(new Anthropic(), { text: TEXT }, (u) => console.log('usage', u.input_tokens, u.output_tokens))
    console.log(JSON.stringify(r, null, 1))
    expect(r.kind).toBe('CREDIT_CARD')
    expect(r.last4).toBe('4321')
    expect(r.totalDue).toBe(5450)
    expect(r.dueDate).toBe('2026-10-10')
    expect(r.transactions).toHaveLength(4)
    expect(r.transactions.find((t) => /PAYMENT/.test(t.description))).toMatchObject({ direction: 'CREDIT', category: 'CARD_PAYMENT' })
    expect(r.transactions.find((t) => /HPCL/.test(t.description))?.category).toBe('FUEL')
  },
  180_000
)
