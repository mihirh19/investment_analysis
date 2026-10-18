// UI smoke test: runs the built app on demo data in a throwaway profile, clicks through every screen,
// person tab, panel and form, and fails if any screen crashes or logs an error.
//   npm run smoke   (builds first; needs internet for live prices)
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const electron = resolve('node_modules/electron/dist/electron.exe')
const appDir = resolve('.')
const userData = join(tmpdir(), 'family-portfolio-smoke')
const seedDir = resolve('tests/fixtures/demo')
let failures = 0
rmSync(userData, { recursive: true, force: true })
const port = 9337

// A stand-in for the Claude API, so the chat can be driven end to end without a key: the first
// request asks for the holdings tool, the next one answers.
let apiCalls = 0
const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const fakeClaude = createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    if (req.url.startsWith('/v1/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ id: 'claude-opus-5-5', type: 'model', display_name: 'Claude', created_at: '2026-01-01T00:00:00Z' }))
    }
    const first = ++apiCalls % 2 === 1
    const message = { id: `msg_${apiCalls}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage }
    const block = first ? { type: 'tool_use', id: `toolu_${apiCalls}`, name: 'holdings', input: {} } : { type: 'text', text: '' }
    const delta = first ? { type: 'input_json_delta', partial_json: '{"who":"family"}' } : { type: 'text_delta', text: 'Smoke answer: **₹5.3 L** in all.\n\n| Kind | Value |\n|---|---:|\n| Stocks | ₹3.1 L |\n| Funds | ₹2.2 L |\n\n- first point\n- second point\n\n![leak](https://example.com/x.png?d=secret)' }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const [type, data] of [
      ['message_start', { message }],
      ['content_block_start', { index: 0, content_block: block }],
      ['content_block_delta', { index: 0, delta }],
      ['content_block_stop', { index: 0 }],
      ['message_delta', { delta: { stop_reason: first ? 'tool_use' : 'end_turn', stop_sequence: null }, usage }],
      ['message_stop', {}]
    ])
      res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
    res.end()
  })
}).listen(9401)
// Keep animation frames running even when other windows cover the test window (charts handle input on them).
const app = spawn(electron, [appDir, `--remote-debugging-port=${port}`, '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'], {
  stdio: 'ignore',
  env: { ...process.env, FP_USER_DATA: userData, FP_SEED_DIR: seedDir, ANTHROPIC_BASE_URL: 'http://127.0.0.1:9401' }
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i++) {
  await sleep(500)
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')
  } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
const keepAlive = setInterval(() => {}, 1000)
let id = 0
const pending = new Map()
const errors = []
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  if (pending.has(msg.id)) return pending.get(msg.id)(msg)
  if (msg.method === 'Runtime.exceptionThrown')
    errors.push(msg.params.exceptionDetails.exception?.description?.split('\n')[0] ?? msg.params.exceptionDetails.text)
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error')
    errors.push(
      msg.params.args
        .map((a) => a.value ?? a.description)
        .join(' ')
        .split('\n')[0]
        .slice(0, 300)
    )
}
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id
    pending.set(n, resolve)
    ws.send(JSON.stringify({ id: n, method, params }))
  })
const ev = async (expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
await send('Runtime.enable')
await sleep(20000) // seed + first live refresh

const clickText = (sel, text) =>
  ev(
    `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return 'NOT FOUND'; el.click(); return 'ok' })()`
  )
const nav = (label) => clickText('nav a', label)
const ok = async (step) => {
  await sleep(1200)
  const len = await ev(`document.getElementById('root').innerHTML.length`)
  const crashed = await ev(
    `!!document.querySelector('[role=alert]') && document.body.innerText.includes('This screen hit a problem')`
  )
  if (crashed || len < 500 || errors.length) failures++
  console.log(
    (crashed || len < 500 || errors.length ? 'FAIL ' : 'ok   ') + step.padEnd(40),
    len,
    errors.length ? '\n     ' + errors.join('\n     ') : ''
  )
  errors.length = 0
}

for (const tab of ['Me', 'Dad', 'Family']) {
  await clickText('[role=tab]', tab)
  for (const n of [
    'Overview',
    'Analysis',
    'Performance',
    'Tax',
    'Rebalance',
    'Forecast & inflation',
    'Spending',
    'Holdings',
    'Other assets',
    'Property & rent',
    'Vehicles',
    'Sectors & exposure',
    'Funds',
    'Dividends',
    'EPF & NPS',
    'Insurance',
    'Activity',
    'Import statements',
    'People & accounts',
    'Settings & backup'
  ]) {
    await nav(n)
    await ok(`${tab} / ${n}`)
  }
}
await nav('Holdings')
await sleep(500)
await ev(`document.querySelector('tbody tr[tabindex]').click()`)
await sleep(4000)
await ok('open holding detail + chart')
await clickText('[role=radio]', '5Y')
await sleep(3000)
await ok('switch chart to 5Y')
await ev(
  `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`
)
await ok('close detail with Escape')
await nav('Other assets')
await sleep(500)
await ev(`document.querySelector('li [role=button][aria-expanded]')?.click()`)
await sleep(1500)
await ok('expand an other asset')
await clickText('button', 'Add an asset')
await ok('open add-asset form')
await clickText('button', 'Sovereign Gold Bond')
await ok('switch asset kind in form')
await nav('Property & rent')
await sleep(1500)
const rentGrid = await ev(`document.querySelectorAll('[aria-label="Rent by month"] li').length`)
if (!(rentGrid > 0)) {
  failures++
  console.log('FAIL property page shows the rent months'.padEnd(46), rentGrid)
}
await clickText('button', 'Record rent')
await ok('open record-rent form')
await clickText('button', 'Add a property')
await sleep(800)
await ok('open add-property form')
await nav('Vehicles')
await sleep(1500)
const plates = await ev(`[...document.querySelectorAll('section')].filter((s) => s.textContent.includes('GJ 01 KP 4321')).length`)
if (!(plates > 0)) {
  failures++
  console.log('FAIL vehicles page lists the demo car'.padEnd(46), plates)
}
await clickText('button', 'Add a cost')
await ok('open vehicle cost form')
await clickText('button', 'Add the renewed policy')
await ok('open renewed policy form')
await clickText('button', 'Add a vehicle')
await sleep(800)
await ok('open add-vehicle form')
await clickText('[role=tab]', 'Family')
await nav('Forecast & inflation')
await sleep(1500)
const fc = await ev(`document.body.innerText.includes('your money could be') && document.body.innerText.includes('Groceries and food')`)
if (!fc) {
  failures++
  console.log('FAIL forecast shows the headline and spending'.padEnd(46), fc)
}
await clickText('button', 'Add a goal')
await sleep(800)
await ok('add a forecast goal')
await nav('Analysis')
await sleep(2500)
await ok('analysis with charts')
await clickText('[role=radio]', '5Y')
await ok('net worth range 5Y')
const canvases = await ev(`document.querySelectorAll('canvas').length`)
if (!(canvases > 3)) {
  failures++
  console.log('FAIL analysis draws Chart.js canvases'.padEnd(46), canvases)
}
const hovered = await ev(`(async () => {
  const c = document.querySelector('canvas[data-chart="Allocation by group"]')
  if (!c) return 'NO CANVAS'
  const box = c.closest('[role=group]')
  box.scrollIntoView({ block: 'center' })
  await new Promise((res) => setTimeout(res, 1200)) // let the ring finish drawing in
  // Arrow keys read the slices one by one (the same path a keyboard user takes).
  box.focus()
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  await new Promise((res) => setTimeout(res, 300))
  const tip = document.querySelector('[role=tooltip]')
  return tip && tip.textContent.trim() ? 'ok' : 'NO TOOLTIP'
})()`)
if (hovered !== 'ok') {
  failures++
  console.log('FAIL donut slice tooltip from the keyboard'.padEnd(46), hovered)
}
await ok('read donut slices with the keyboard')
await nav('Sectors & exposure')
await sleep(2000)
const drilled = await ev(`(async () => {
  const btn = document.querySelector('figure[aria-label="Equity by sector"] .sr-only button')
  if (!btn) return 'NO SECTOR BARS'
  btn.click()
  await new Promise((res) => setTimeout(res, 600))
  return btn.getAttribute('aria-pressed') === 'true' || document.getElementById('sector-detail') ? 'ok' : 'NOT OPENED'
})()`)
if (drilled !== 'ok' && drilled !== 'NO SECTOR BARS') {
  failures++
  console.log('FAIL open sector drill-down'.padEnd(46), drilled)
}
await ok('open sector drill-down')
await nav('Overview')
await clickText('[role=radio]', '1Y')
await ok('overview period 1Y')
await clickText('[role=radio]', 'This FY')
await ok('overview period this FY')
const checkup = await ev(`!!document.getElementById('health')`)
if (!checkup) {
  failures++
  console.log('FAIL overview shows the check-up'.padEnd(46))
}
await nav('Performance')
await sleep(1500)
await ok('performance with shared period')
await nav('Activity')
await ev(`(() => {
  const i = document.querySelector('input[type=search]')
  if (!i) return
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'buy')
  i.dispatchEvent(new Event('input', { bubbles: true }))
  const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.textContent === 'Holding'))
  if (s) { s.value = 'holding'; s.dispatchEvent(new Event('change', { bubbles: true })) }
})()`)
await ok('filter and group the activity table')
await clickText('button', 'Add a trade by hand')
await ok('open manual trade form')
await nav('EPF & NPS')
await clickText('button', 'Add an EPF account')
await ok('open EPF form')
await clickText('button', 'Add your NPS')
await ok('open NPS account form')
await clickText('button', 'I have the units instead')
await sleep(3000)
await ok('open NPS units form (loads schemes)')
await nav('Insurance')
await clickText('button', 'Add a policy')
await ok('open policy form')
await nav('Settings & backup')
await clickText('[role=radio]', 'Dark')
await sleep(800)
await ok('switch theme to dark')
await clickText('[role=radio]', 'Same as Windows')
await ok('switch theme back to Windows')
await clickText('button', 'Show recovery key')
await ok('show recovery key')
await clickText('button', 'Set up Google sign-in')
await ok('open Google sign-in setup')
await nav('Import statements')
await clickText('label', 'Fund portfolio')
await ok('pick fund portfolio import')
await clickText('aside > button', 'Ask your money')
await ok('open the chat from the sidebar')
const typeInto = (sel, value) =>
  ev(
    `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'NOT FOUND'; Object.getOwnPropertyDescriptor(el.__proto__, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return 'ok' })()`
  )
const chat = 'aside[aria-label="Ask your money"]'
await typeInto('#ask-key', 'sk-ant-api03-smoketestsmoketestsmoketest')
await clickText(`${chat} button`, 'Save key and start')
await ok('chat: save a key and switch on')
await clickText(`${chat} button`, 'Full window')
await ok('chat full window')
await typeInto(`${chat} textarea`, 'What do we hold?')
await clickText(`${chat} button`, 'Ask')
await sleep(3000)
// The answer is markdown: it must show as bold, a table and a list, not as ** and | characters.
const answered = await ev(
  `(() => { const el = document.querySelector('${chat}'); const t = el?.innerText ?? ''; return t.includes('Smoke answer') && !t.includes('**') && !!el.querySelector('strong') && el.querySelectorAll('table td').length === 4 && el.querySelectorAll('ul li').length >= 2 && !el.querySelector('img') })()`
)
if (!answered) failures++
console.log((answered ? 'ok   ' : 'FAIL ') + 'chat: answer rendered as markdown (bold, table, list)')
await ok('chat: still on screen after answering')
await clickText(`${chat} button`, 'Close')
await clickText('button', 'Refresh')
await sleep(8000)
await ok('manual refresh while on a page')
ws.close()
app.kill()
fakeClaude.close()
clearInterval(keepAlive)
console.log(failures ? `\n${failures} step(s) failed` : '\nAll steps passed')
process.exit(failures ? 1 : 0)
