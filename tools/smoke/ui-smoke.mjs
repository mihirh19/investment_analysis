// UI smoke test: runs the built app on demo data in a throwaway profile, clicks through every screen,
// person tab, panel and form, and fails if any screen crashes or logs an error.
//   npm run smoke   (builds first; needs internet for live prices)
import { spawn } from 'node:child_process'
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
const app = spawn(electron, [appDir, `--remote-debugging-port=${port}`], {
  stdio: 'ignore',
  env: { ...process.env, FP_USER_DATA: userData, FP_SEED_DIR: seedDir }
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
    'Holdings',
    'Other assets',
    'Sectors & exposure',
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
  const r = c.getBoundingClientRect()
  // A point on the ring, straight above the centre.
  c.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + 22 }))
  await new Promise((res) => setTimeout(res, 400))
  return document.querySelector('[role=tooltip]') ? 'ok' : 'NO TOOLTIP'
})()`)
if (hovered !== 'ok') {
  failures++
  console.log('FAIL hover donut slice shows tooltip'.padEnd(46), hovered)
}
await ok('hover donut slice')
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
await nav('Activity')
await clickText('button', 'Add a trade by hand')
await ok('open manual trade form')
await nav('EPF & NPS')
await clickText('button', 'Add an EPF account')
await ok('open EPF form')
await clickText('button', 'Add NPS units by hand')
await sleep(3000)
await ok('open NPS form (loads schemes)')
await nav('Insurance')
await clickText('button', 'Add a policy')
await ok('open policy form')
await nav('Settings & backup')
await clickText('button', 'Show recovery key')
await ok('show recovery key')
await nav('Import statements')
await clickText('label', 'Fund portfolio')
await ok('pick fund portfolio import')
await clickText('button', 'Refresh')
await sleep(8000)
await ok('manual refresh while on a page')
ws.close()
app.kill()
clearInterval(keepAlive)
console.log(failures ? `\n${failures} step(s) failed` : '\nAll steps passed')
process.exit(failures ? 1 : 0)
