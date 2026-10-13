import { useEffect, useRef, useState } from 'react'

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Eases a number from its previous value to the new one (instant when motion is reduced). */
export function useCountUp(target: number, durationMs = 900): number {
  const [shown, setShown] = useState(target)
  const from = useRef(target)
  const first = useRef(true)

  useEffect(() => {
    if (!Number.isFinite(target)) return
    // First paint counts up from zero; later changes glide from the last value.
    const start = first.current ? 0 : from.current
    first.current = false
    if (prefersReducedMotion() || start === target) {
      from.current = target
      setShown(target)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs)
      const eased = 1 - (1 - p) ** 4
      setShown(start + (target - start) * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      from.current = target
    }
  }, [target, durationMs])

  return shown
}

/**
 * Returns "flash-up" / "flash-down" for a moment after the value changes, like a ticker.
 * The key changes on every move so a repeated move restarts the animation.
 */
export function useFlash(value: number | null | undefined): { className: string; key: number } {
  const prev = useRef(value)
  const [state, setState] = useState({ className: '', key: 0 })
  useEffect(() => {
    const before = prev.current
    prev.current = value
    if (before == null || value == null || before === value) return
    setState((s) => ({ className: value > before ? 'flash-up' : 'flash-down', key: s.key + 1 }))
  }, [value])
  return state
}

/** Inline style for a staggered entrance: each mark starts a little after the previous one. */
export const stagger = (i: number, stepMs = 40, maxMs = 400) => ({ animationDelay: `${Math.min(i * stepMs, maxMs)}ms` })
