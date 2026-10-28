import XLSX from 'xlsx'

/**
 * Spreadsheets as grids of cells, one per sheet. Reading a big workbook (AMFI's expense ratios are
 * 4 MB, a fund house's monthly portfolio a few) takes seconds of solid work, so the app does it in a
 * separate process (see worker.ts) and the window stays responsive; tests read in place.
 */

export interface Grid {
  name: string
  rows: unknown[][]
}

export interface SheetOptions {
  /** Dates as Date objects rather than serial numbers. */
  cellDates?: boolean
  /** Only the first n sheets. */
  first?: number
}

/** The reading itself: also what the separate process runs. */
export function parseSheets(data: Uint8Array, opts: SheetOptions = {}): Grid[] {
  const wb = XLSX.read(data, { type: 'buffer', cellDates: !!opts.cellDates })
  const names = opts.first ? wb.SheetNames.slice(0, opts.first) : wb.SheetNames
  return names.map((name) => ({ name, rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '', raw: true }) }))
}

type Runner = (data: Uint8Array, opts: SheetOptions) => Promise<Grid[]>
let runner: Runner | null = null

/** Set by the app at start: where workbooks are read (a separate process). */
export function setSheetRunner(r: Runner | null): void {
  runner = r
}

export async function readSheets(data: Uint8Array | ArrayBuffer, opts: SheetOptions = {}): Promise<Grid[]> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (runner) {
    try {
      return await runner(bytes, opts)
    } catch (e) {
      // The separate process failed to start or crashed: read here rather than not at all.
      if (!(e instanceof Error && /sheet process/i.test(e.message))) throw e
    }
  }
  return parseSheets(bytes, opts)
}
