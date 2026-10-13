/** Axis ticks on round numbers (1, 2, 2.5, 5 × 10ⁿ) spanning [min, max]. */
const niceStep = (range: number, count: number) => {
  const raw = range / Math.max(1, count)
  const pow = 10 ** Math.floor(Math.log10(raw || 1))
  const n = raw / pow
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow
}

export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1
    min -= pad
    max += pad
  }
  const step = niceStep(max - min, count)
  const start = Math.floor(min / step) * step
  const out: number[] = [Number(start.toFixed(10))]
  // Always end on a tick at or above the maximum so no mark pokes out of the plot.
  while (out[out.length - 1] < max) out.push(Number((out[out.length - 1] + step).toFixed(10)))
  return out
}
