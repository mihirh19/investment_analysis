import { parseSheets, type SheetOptions } from './read'

// Runs in Electron's utility process: reads workbooks sent by the main process and sends back their
// grids, so the long, all-at-once work of reading a spreadsheet never holds up the app.

interface Request {
  id: number
  data: Uint8Array
  opts: SheetOptions
}

process.parentPort.on('message', (e: { data: Request }) => {
  const { id, data, opts } = e.data
  try {
    process.parentPort.postMessage({ id, grids: parseSheets(data, opts) })
  } catch (err) {
    process.parentPort.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
})
