import { useEffect } from 'react'
import { SECTIONS } from '../lib/nav'
import { useTerminal } from '../lib/terminal'
import { PANELS } from '../components/workspace/panels'

/** Every screen and tool, grouped, with its code. Click opens in the tab you are on; Ctrl+click in a new tab. */
export function Menu({ onClose }: { onClose: () => void }) {
  const terminal = useTerminal()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const open = (route: string, newTab: boolean) => {
    onClose()
    terminal?.openScreen(route, { newTab })
  }
  return (
    <div className="fixed inset-0 z-40 bg-black/60 pt-[52px]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        onMouseDown={(e) => e.stopPropagation()}
        className="mx-auto max-h-[calc(100vh-80px)] w-[min(1100px,96vw)] overflow-y-auto rounded-sm border border-stamp bg-sheet p-4 shadow-2xl"
      >
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="wide text-[18px] font-semibold text-stamp">Menu</h2>
          <span className="text-[12px] text-ink-muted">Click to open here, Ctrl+click for a new tab. Esc closes.</span>
        </div>
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          {SECTIONS.map((s) => (
            <section key={s.label} aria-label={s.label}>
              <h3 className="mb-1 border-b border-rule pb-0.5 text-[12.5px] font-semibold text-ink-muted">{s.label}</h3>
              <ul>
                {s.pages.map((p) => (
                  <li key={p.to}>
                    <button
                      type="button"
                      onClick={(e) => open(p.to, e.ctrlKey || e.metaKey)}
                      onAuxClick={(e) => e.button === 1 && open(p.to, true)}
                      className="flex w-full items-baseline gap-2 rounded-sm px-1 py-0.5 text-left text-[14px] hover:bg-stamp-wash hover:text-stamp"
                    >
                      <span className="w-11 shrink-0 font-mono text-[11px] font-semibold text-stamp">{p.code}</span>
                      {p.label}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section aria-label="Tools">
            <h3 className="mb-1 border-b border-rule pb-0.5 text-[12.5px] font-semibold text-ink-muted">Tool panels</h3>
            <ul>
              {Object.entries(PANELS).map(([k, v]) => (
                <li key={k}>
                  <button
                    type="button"
                    onClick={() => {
                      onClose()
                      terminal?.openPanel(k)
                    }}
                    title={v.about}
                    className="flex w-full items-baseline gap-2 rounded-sm px-1 py-0.5 text-left text-[14px] hover:bg-stamp-wash hover:text-stamp"
                  >
                    <span className="w-11 shrink-0 font-mono text-[11px] text-ink-muted">+</span>
                    {v.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
