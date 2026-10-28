import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { Grid, SheetOptions } from './read'

/**
 * The separate process that reads spreadsheets: started on first use, kept for the session, and
 * started again if it ever exits. Each request waits at most two minutes.
 */
export function sheetProcessRunner(dir: string) {
  let child: UtilityProcess | null = null
  let next = 1
  const waiting = new Map<number, { resolve: (g: Grid[]) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

  const start = () => {
    const p = utilityProcess.fork(join(dir, 'sheets.js'), [], { serviceName: 'Family Portfolio spreadsheets' })
    p.on('message', (m: { id: number; grids?: Grid[]; error?: string }) => {
      const w = waiting.get(m.id)
      if (!w) return
      waiting.delete(m.id)
      clearTimeout(w.timer)
      if (m.error) w.reject(new Error(m.error))
      else w.resolve(m.grids ?? [])
    })
    p.on('exit', () => {
      child = null
      for (const [id, w] of waiting) {
        clearTimeout(w.timer)
        w.reject(new Error('The sheet process stopped'))
        waiting.delete(id)
      }
    })
    return p
  }

  return (data: Uint8Array, opts: SheetOptions): Promise<Grid[]> =>
    new Promise((resolve, reject) => {
      child ??= start()
      const id = next++
      const timer = setTimeout(() => {
        waiting.delete(id)
        reject(new Error('The sheet process took too long'))
      }, 120_000)
      waiting.set(id, { resolve, reject, timer })
      child.postMessage({ id, data, opts })
    })
}
