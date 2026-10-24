// Development aid: opens the built app on demo data and saves a screenshot of each route given.
//   npx electron-vite build && node tools/research/look.mjs <output dir> "js:document.title" "shot:start@2000"
// Each step is a screenshot name ("shot:<name>@<ms>"), a script to run in the window ("js:<code>",
// its result printed), or a wait ("wait:<ms>"). Console errors are printed at the end.
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const [outArg, ...routes] = process.argv.slice(2)
const out = resolve(outArg ?? join(tmpdir(), 'fp-research-look'))
mkdirSync(out, { recursive: true })
const userData = join(tmpdir(), 'family-portfolio-research-look')
rmSync(userData, { recursive: true, force: true })
const port = 9339
const app = spawn(resolve('node_modules/electron/dist/electron.exe'), [resolve('.'), `--remote-debugging-port=${port}`], {
  stdio: 'ignore',
  env: { ...process.env, FP_USER_DATA: userData, FP_SEED_DIR: resolve('tests/fixtures/demo') }
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
let id = 0
const pending = new Map()
const errors = []
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  if (pending.has(msg.id)) return pending.get(msg.id)(msg)
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error')
    errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300))
}
const send = (method, params = {}) =>
  new Promise((res) => {
    const n = ++id
    pending.set(n, res)
    ws.send(JSON.stringify({ id: n, method, params }))
  })
await send('Runtime.enable')
await sleep(12000)
let n = 0
for (const step of routes) {
  if (step.startsWith('js:')) {
    const r = await send('Runtime.evaluate', { expression: step.slice(3), awaitPromise: true, returnByValue: true })
    console.log('js', JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? null).slice(0, 2000))
  } else if (step.startsWith('wait:')) {
    await sleep(Number(step.slice(5)))
  } else {
    const [name, wait] = step.replace(/^shot:/, '').split('@')
    await sleep(Number(wait ?? 1500))
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const file = `${++n}-${name.replace(/[^\w]+/g, '-')}.png`
    writeFileSync(join(out, file), Buffer.from(shot.result.data, 'base64'))
    console.log('saved', file)
  }
}
console.log(errors.length ? `console errors:\n  ${errors.join('\n  ')}` : 'no console errors')
ws.close()
app.kill()
