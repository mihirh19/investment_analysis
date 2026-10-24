// Development aid: opens the built app on demo data, drives the World tab and saves screenshots.
//   npx electron-vite build && node tools/world/look.mjs <output dir>
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const out = resolve(process.argv[2] ?? join(tmpdir(), 'fp-world-look'))
mkdirSync(out, { recursive: true })
const userData = join(tmpdir(), 'family-portfolio-world-look')
rmSync(userData, { recursive: true, force: true })
const port = 9338
const app = spawn(
  resolve('node_modules/electron/dist/electron.exe'),
  [resolve('.'), `--remote-debugging-port=${port}`],
  {
    stdio: 'ignore',
    env: { ...process.env, FP_USER_DATA: userData, FP_SEED_DIR: resolve('tests/fixtures/demo') }
  }
)
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
let id = 0
const pending = new Map()
const errors = []
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  if (pending.has(msg.id)) return pending.get(msg.id)(msg)
  if (msg.method === 'Runtime.exceptionThrown')
    errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning'))
    errors.push(
      `${msg.params.type}: ${msg.params.args
        .map((a) => a.value ?? a.description)
        .join(' ')
        .slice(0, 300)}`
    )
}
const send = (method, params = {}) =>
  new Promise((res) => {
    const n = ++id
    pending.set(n, res)
    ws.send(JSON.stringify({ id: n, method, params }))
  })
const ev = async (expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(out, `${name}.png`), Buffer.from(r.result.data, 'base64'))
}
const pick = (label, value) =>
  ev(
    `(() => { const s = document.querySelector('select[aria-label="${label}"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(value)}); s.dispatchEvent(new Event('change', { bubbles: true })) })()`
  )
await send('Runtime.enable')
await sleep(15000)
await ev(`location.hash = '#/research/world'`)
await sleep(8000)
await shot('1-map')
await pick('Find a country', 'CHN')
await sleep(1500)
await shot('2-china')
await pick('Colour countries by', 'policyRate')
await pick('Trade direction', 'X')
await pick('Goods', '85')
await pick('Find a country', 'USA')
await sleep(1500)
await shot('3-policy-exports-usa')
await ev(`document.querySelector('main').scrollTo(0, 10000)`)
await sleep(800)
await shot('4-tables')
await ev(
  `document.querySelector('main').scrollTo(0, 0); [...document.querySelectorAll('section[aria-label=Chokepoints] tbody tr')].find(r => r.textContent.includes('Hormuz'))?.click()`
)
await sleep(1500)
await shot('5-hormuz')
console.log(errors.length ? errors.join('\n') : 'no console errors')
ws.close()
app.kill()
process.exit(0)
