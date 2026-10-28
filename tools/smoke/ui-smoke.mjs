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
  // The screens are walked in the terminal (its menu reaches every one); the simple look is checked after.
  env: { ...process.env, FP_USER_DATA: userData, FP_SEED_DIR: seedDir, FP_THEME: 'terminal', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9401' }
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
// Polls an expression until it is truthy (or the time runs out); returns its last value.
const waitFor = async (expression, ms = 10000) => {
  const end = Date.now() + ms
  for (;;) {
    const v = await ev(expression)
    if (v || Date.now() > end) return v
    await sleep(400)
  }
}
// Every screen opens in a terminal tab: through a screen's own section tabs when it is a sibling,
// otherwise from the Menu (which opens it in the tab that has focus). "Research" is the Monitor.
const nav = async (label) => {
  const want = label === 'Research' ? 'Monitor' : label
  const inTab = await ev(`(() => { const a = [...document.querySelectorAll('[data-screen] nav a')].find((e) => e.textContent.trim() === ${JSON.stringify(want)}); if (!a) return 'NOT FOUND'; a.click(); return 'ok' })()`)
  if (inTab === 'ok') return 'ok'
  await ev(`[...document.querySelectorAll('header button')].find((b) => b.textContent.trim() === 'Menu')?.click()`)
  await sleep(250)
  return ev(`(() => { const b = [...document.querySelectorAll('[aria-label=Menu] button')].find((e) => e.textContent.trim().endsWith(${JSON.stringify(want)}) && !e.title); if (!b) return 'NOT FOUND'; b.click(); return 'ok' })()`)
}
/** In the simple look: Settings, from the More menu. */
const simpleSettings = async () => {
  await ev(`[...document.querySelectorAll('nav[aria-label=Main] button')].find((b) => b.textContent.trim() === 'More')?.click()`)
  await sleep(300)
  await ev(`[...document.querySelectorAll('nav[aria-label=Main] a')].find((a) => a.textContent.trim() === 'Settings & backup')?.click()`)
  await sleep(1200)
}
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
    'Farm',
    'Loans & EMIs',
    'Sectors & exposure',
    'Funds',
    'Dividends',
    'X-ray',
    'Calendar',
    'EPF & NPS',
    'Insurance',
    'Activity',
    'Import statements',
    'People & accounts',
    'Settings & backup',
    'Research'
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
const fc = await waitFor(`document.body.innerText.includes('your money could be') && document.body.innerText.includes('Groceries and food')`)
if (!fc) {
  failures++
  console.log('FAIL forecast shows the headline and spending'.padEnd(46), fc, JSON.stringify(await ev(`location.hash + ' | ' + document.querySelector('main')?.innerText.slice(0, 400)`)))
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
await sleep(1500)
await ok('switch theme to dark')
// Dark is the simple layout in dark colours: back to Settings through More.
await simpleSettings()
await clickText('[role=radio]', 'Terminal')
await ok('switch theme to terminal')
const terminalOn = await ev(`document.documentElement.classList.contains('terminal')`)
if (!terminalOn) failures++
console.log((terminalOn ? 'ok   ' : 'FAIL ') + 'terminal theme applied outside Research')
// The terminal opens its saved workspace: Settings again from the menu.
await nav('Settings & backup')
await sleep(800)
// The simple look: its own frame, every top-bar area and the home screen.
await clickText('[role=radio]', 'Simple')
await sleep(1500)
const simpleOn = await ev(`document.documentElement.classList.contains('simple') && !!document.querySelector('nav[aria-label=Main]')`)
if (!simpleOn) failures++
console.log((simpleOn ? 'ok   ' : 'FAIL ') + 'simple look shows its top bar')
for (const area of ['Home', 'Investments', 'Stocks', 'Mutual funds', 'Farm', 'Plan']) {
  await ev(`[...document.querySelectorAll('nav[aria-label=Main] a')].find((a) => a.textContent.trim() === ${JSON.stringify(area)})?.click()`)
  await ok(`simple: ${area}`)
}
await simpleSettings()
await ok('simple: More, Settings')
await clickText('[role=radio]', 'Same as Windows')
await sleep(1500)
await ok('switch theme to Windows (simple layout)')
await simpleSettings()
await clickText('[role=radio]', 'Terminal')
await sleep(1500)
await ok('back to the terminal')
await nav('Settings & backup')
await sleep(800)
await clickText('button', 'Show recovery key')
await ok('show recovery key')
await clickText('button', 'Set up Google sign-in')
await ok('open Google sign-in setup')
const aisShown = await ev(`document.body.innerText.includes('Live ships') && document.body.innerText.includes('aisstream.io API key')`)
if (!aisShown) failures++
console.log((aisShown ? 'ok   ' : 'FAIL ') + 'settings: live ships key section')
await nav('Import statements')
await clickText('label', 'Fund portfolio')
await ok('pick fund portfolio import')
await nav('Loans & EMIs')
await sleep(2000)
const loansShown = await ev(`document.body.innerText.includes('Kisan Credit Card') && document.body.innerText.includes('Owed today')`)
if (!loansShown) failures++
console.log((loansShown ? 'ok   ' : 'FAIL ') + 'loans: KCC and what is owed shown')
await clickText('button', 'Add a loan')
await ok('loans: open the loan form')
await clickText('button', 'Cancel')
await nav('Overview')
await sleep(2000)
const netShown = await ev(`document.body.innerText.includes('Owed on loans') && document.body.innerText.includes('Net worth,')`)
if (!netShown) failures++
console.log((netShown ? 'ok   ' : 'FAIL ') + 'overview: net worth after loans')
await nav('Farm')
await sleep(2500)
const farmShown = await ev(`document.body.innerText.includes('In the godown') && document.body.innerText.includes('Groundnut') && document.body.innerText.includes('Mandi prices')`)
if (!farmShown) failures++
console.log((farmShown ? 'ok   ' : 'FAIL ') + 'farm: godown, prices and seasons shown')
const outlookShown = await ev(`document.body.innerText.includes('Selling: outlook and facts') && document.body.innerText.includes('What keeping it in the godown costs')`)
if (!outlookShown) failures++
console.log((outlookShown ? 'ok   ' : 'FAIL ') + 'farm: selling outlook shown')
await clickText('button', 'Add a crop season')
await ok('farm: open the season form')
await clickText('button', 'Cancel')
await clickText('button', 'Record a sale')
await ok('farm: open the sale form')
await clickText('button', 'Cancel')
// Research: the family's stocks, then one company's overview, financials and chart.
await nav('Research')
await waitFor(`document.body.innerText.includes('Nifty Bank') && document.body.innerText.includes('Your stocks')`)
const researchHome = await ev(`[document.body.innerText.includes('NSE indices'), document.body.innerText.includes('Nifty Bank'), document.body.innerText.includes('Your stocks')].join(',')`)
if (researchHome !== 'true,true,true') { failures++; console.log(JSON.stringify(await ev(`location.hash + ' | ' + document.querySelector('main')?.innerText.slice(0, 400)`))) }
console.log((researchHome === 'true,true,true' ? 'ok   ' : 'FAIL ') + 'research: monitor tab ' + researchHome)
await sleep(4000)
await ok('research: world markets loaded')
await nav('Screener')
await sleep(1500)
const screened = await ev(`/compan(y|ies) match/.test(document.body.innerText)`)
if (!screened) failures++
console.log((screened ? 'ok   ' : 'FAIL ') + 'screener: results counted')
for (const preset of ['Magic Formula', 'Coffee Can', 'Graham value']) {
  await clickText('nav[aria-label=Screens] button', preset)
  await ok(`screener: ${preset}`)
}
await clickText('button', '+ New screen')
await clickText('button', '+ Add a filter')
await ok('screener: own filters')
await nav('Monitor')
await sleep(1500)
await clickText('section[aria-label="Your stocks"] tbody tr', 'TCS')
await sleep(1500)
const companyShown = await ev(`document.body.innerText.includes('52-week range') && document.body.innerText.includes('Market cap')`)
if (!companyShown) failures++
console.log((companyShown ? 'ok   ' : 'FAIL ') + 'research: company overview with ratios')
await clickText('[role=tab]', 'Financials')
await ok('research: quarterly results')
const finShown = await ev(`document.body.innerText.includes('Operating profit') && document.body.innerText.includes('Sep 26')`)
if (!finShown) failures++
console.log((finShown ? 'ok   ' : 'FAIL ') + 'research: results table')
for (const st of ['Yearly results', 'Balance sheet', 'Cash flow']) {
  await clickText('[role=radio]', st)
  await ok(`research: ${st.toLowerCase()}`)
}
await clickText('[role=tab]', 'Price chart')
await sleep(2500)
await ok('research: price chart')
await clickText('[role=tab]', 'Valuation')
await ok('research: valuation tab')
await clickText('[role=tab]', 'Ownership')
await ok('research: ownership tab')
await clickText('[role=tab]', 'Peers')
await sleep(1000)
await ok('research: peers')
// World map: deck.gl on the demo copy of the world data (its background updates stay off).
const check = async (name, expression, ms = 10000) => {
  const v = await waitFor(expression, ms)
  if (!v) failures++
  console.log((v ? 'ok   ' : 'FAIL ') + name)
  // On a failure, which tabs were open (and which were showing) says most about what went wrong.
  if (!v) console.log('     tabs:', await ev(`[...document.querySelectorAll('.dv-tab')].map((t) => (t.classList.contains('dv-active-tab') ? '*' : '') + t.textContent.trim()).join(' | ')`))
  if (!v) console.log('     saved:', await ev(`window.api.getWorkspaces().then((r) => JSON.stringify(r.data.map((w) => [w.id, Object.values(w.layout?.panels ?? {}).map((p) => p.contentComponent + ':' + (p.params?.route ?? ''))])))`))
  return v
}
const pickOption = (label, value) =>
  ev(`(() => { const s = document.querySelector('select[aria-label="${label}"]'); if (!s) return 'NOT FOUND'; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(value)}); s.dispatchEvent(new Event('change', { bubbles: true })); return 'ok' })()`)
const key = (k) => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`)
await nav('World')
await check('world: map drawn with layers and legend', `!!document.querySelector('[aria-label="World map"] canvas') && !!document.querySelector('[aria-label=Legend]') && document.body.innerText.includes('Suez Canal')`, 20000)
await sleep(3000)
await ok('world: map page')
await pickOption('Colour countries by', 'inflation')
await check('world: coloured by inflation', `document.querySelector('[aria-label=Legend]').innerText.includes('Inflation')`)
await pickOption('Trade direction', 'X')
await pickOption('Goods', '2709')
await ok('world: crude oil exports')
await pickOption('Find a country', 'CHN')
await check('world: country panel with trade', `document.querySelector('[role=dialog]')?.innerText.includes('Trade with India') && document.querySelector('[role=dialog]').innerText.includes('Figures')`)
await key('Escape')
await check('world: panel closes on Escape', `!document.querySelector('[role=dialog]')`)
await key('5')
await check('world: key 5 hides chokepoints', `[...document.querySelectorAll('[aria-label="Map layers"] button')].find(b => b.textContent.includes('Chokepoints'))?.getAttribute('aria-pressed') === 'false'`)
await key('5')
await clickText('section[aria-label=Chokepoints] tbody tr', 'Suez Canal')
await check('world: chokepoint panel', `document.querySelector('[role=dialog]')?.innerText.includes('Transits a day')`)
await pickOption('Colour countries by', 'growth')
await check('world: year slider for yearly figures', `!!document.querySelector('input[type=range][aria-label=Year]')`)
await clickText('[aria-label="Map layers"] button', '4')
await sleep(4000)
await ok('world: ships layer on')
await clickText('[aria-label="Map layers"] button', '4')
await ok('world: ships layer off')
const typeInto = (sel, value) =>
  ev(
    `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'NOT FOUND'; Object.getOwnPropertyDescriptor(el.__proto__, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return 'ok' })()`
  )
await nav('X-ray')
await sleep(1500)
await check('x-ray: concentration or empty note', `document.body.innerText.includes('Behaves like') || document.body.innerText.includes('No Indian equity')`)
await nav('Calendar')
await clickText('[aria-label="Which companies"] button', 'All companies')
await ok('calendar: all companies')
await nav('Sectors')
await ok('research: sectors')
await nav('Announcements')
await ok('research: announcements')
await nav('Alerts')
await ok('alerts: screen')
await nav('Commodities')
await ok('research: commodities')
await nav('Fund screener')
await ok('research: fund screener')
// Markets: Indian ETFs, then the shipped UCITS list (there before any download), then a UCITS fund's page.
for (const m of ['Indian ETFs', 'UCITS ETFs', 'US ETFs']) {
  await ev(`[...document.querySelectorAll('[aria-label=Market] label')].find((l) => l.textContent.trim().startsWith(${JSON.stringify(m)}))?.querySelector('input')?.click()`)
  await ok(`fund screener: ${m}`)
}
await ev(`[...document.querySelectorAll('[aria-label=Market] label')].find((l) => l.textContent.trim().startsWith('UCITS ETFs'))?.querySelector('input')?.click()`)
await check('fund screener: UCITS list has rows', `document.querySelectorAll('tbody tr').length > 20`)
await ev(`[...document.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('S&P 500'))?.click()`)
await check('fund page: opens for a UCITS ETF', `!!document.querySelector('[role=tablist][aria-label="Fund views"]')`, 20000)
await clickText('[aria-label="Fund views"] button', 'Portfolio')
await ok('fund page: Portfolio tab')
await clickText('[aria-label="Fund views"] button', 'Overview')
await ok('fund page: Overview tab')
await nav('What if')
await ok('planning: what if')
// Money flows: FII/DII, F&O positions, FPI, mutual funds and big deals, on the demo copy.
await nav('Money flows')
await check('flows: FII and DII shown', `document.body.innerText.includes('FII net, 23 Oct 2026') && document.body.innerText.includes('DII net')`)
for (const v of ['F&O positions', 'Foreign investors by month', 'Mutual funds', 'Big deals']) {
  await clickText('[aria-label="Flows view"] button', v)
  await ok(`flows: ${v}`)
}
await check('flows: deals and 5% stakes listed', `document.body.innerText.includes('SAMHI') && document.body.innerText.includes('5% stakes crossed')`)
await clickText('[aria-label="Flows view"] button', 'Ownership changes')
await ok('flows: ownership changes')
// The terminal itself: function keys open screens in tabs, a new tab, tool panels, workspaces.
const tabs = () => ev(`[...document.querySelectorAll('.dv-tab')].map((t) => t.textContent.trim()).join('|')`)
await key('F2')
await check('terminal: F2 shows Holdings in the tab', `[...document.querySelectorAll('.dv-tab.dv-active-tab')].some((t) => t.textContent.includes('Holdings'))`)
const before = (await tabs()).split('|').length
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', shiftKey: true, bubbles: true }))`)
await check('terminal: Shift+F7 opens Farm in a new tab', `document.querySelectorAll('.dv-tab').length === ${before + 1} && [...document.querySelectorAll('.dv-tab')].some((t) => t.textContent.includes('Farm'))`)
await ok('terminal: farm tab')
await key('F5')
await check('terminal: F5 adds a chart panel', `[...document.querySelectorAll('.dv-tab')].filter((t) => t.textContent.trim() === 'Chart').length >= 2`, 15000)
await ok('terminal: chart panel')
await ev(`[...document.querySelectorAll('header button')].find((b) => b.textContent.trim() === 'Menu')?.click()`)
await check('terminal: menu lists every screen', `!!document.querySelector('[aria-label=Menu]') && document.querySelector('[aria-label=Menu]').innerText.includes('FARM')`)
await clickText('[aria-label=Menu] button[title]', '+Notes')
await check('terminal: notes panel from the menu', `!!document.querySelector('textarea[aria-label^="Notes on"]')`)
await typeInto('textarea[aria-label^="Notes on"]', 'Smoke note')
await sleep(1500)
await ok('terminal: note saved')
for (const ws of ['Markets', 'Company', 'Screener', 'Home']) {
  await clickText('[aria-label=Workspaces] [role=tab]', ws)
  await sleep(3000)
  await ok(`terminal: ${ws} workspace`)
}
await pickOption('Watchlist', 'new')
await sleep(1500)
await typeInto('input[aria-label="Add a symbol"]', 'INFY')
await ev(`document.querySelector('input[aria-label="Add a symbol"]').form.requestSubmit()`)
await check('terminal: a new watchlist with a symbol', `[...document.querySelectorAll('table th')].some((t) => t.textContent.trim() === 'INFY')`, 10000)
await ev(`document.querySelector('header button[aria-label="Command line"]').click()`)
await ok('command line: open')
await ev(`document.querySelector('[role=dialog] input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await clickText('header button', 'Ask your money')
await ok('open the chat from the top bar')
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
if (!answered) console.log('     chat shows: ' + JSON.stringify(await ev(`document.querySelector('${chat}')?.innerText.slice(-400)`)) + ', calls to the fake API: ' + apiCalls)
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
