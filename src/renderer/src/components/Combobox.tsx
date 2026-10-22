import { useId, useMemo, useRef, useState } from 'react'

export interface ComboOption {
  value: string
  /** Shown beside the value, e.g. a price or "bold, semi-spreading". */
  detail?: string
  /** Other names it is found by ("37", "G37" for TG-37A). */
  aka?: string[]
}

/**
 * A text box with a searchable list under it: type to filter (by name or any other name), arrow
 * keys to move, Enter to pick, Escape to close. Anything typed can be kept, not only listed values.
 */
export function Combobox({
  value,
  onChange,
  groups,
  label,
  placeholder,
  className = 'w-56'
}: {
  value: string
  onChange: (v: string) => void
  groups: { label: string; options: ComboOption[] }[]
  label: string
  placeholder?: string
  className?: string
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const q = value.trim().toLowerCase().replace(/[\s_-]+/g, '')
  const shown = useMemo(() => {
    const match = (o: ComboOption) =>
      !q || [o.value, ...(o.aka ?? [])].some((n) => n.toLowerCase().replace(/[\s_-]+/g, '').includes(q))
    const seen = new Set<string>()
    return groups
      .map((g) => ({
        label: g.label,
        options: g.options.filter((o) => {
          const k = o.value.toLowerCase()
          if (seen.has(k) || !match(o)) return false
          seen.add(k)
          return true
        })
      }))
      .filter((g) => g.options.length)
  }, [groups, q])
  const flat = shown.flatMap((g) => g.options)
  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
  }
  const optionId = (i: number) => `${id}-o${i}`
  let n = -1

  return (
    <div className={`relative ${className}`}>
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && flat[active] ? optionId(active) : undefined}
        className="w-full rounded-md border border-rule-strong bg-sheet px-2.5 py-1.5 text-[15px] text-ink placeholder:text-ink-muted/70"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((a) => Math.min(flat.length - 1, a + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(0, a - 1))
          } else if (e.key === 'Enter' && open && flat[active]) {
            e.preventDefault()
            pick(flat[active].value)
          } else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && shown.length > 0 && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className="absolute z-30 mt-1 max-h-72 w-[max(100%,320px)] overflow-y-auto rounded-md border border-rule-strong bg-paper py-1 shadow-lg"
        >
          {shown.map((g) => (
            <li key={g.label} role="presentation">
              <div className="px-3 pt-2 pb-1 text-[12px] font-semibold text-ink-muted">{g.label}</div>
              <ul role="group" aria-label={g.label}>
                {g.options.map((o) => {
                  n += 1
                  const i = n
                  return (
                    <li
                      key={o.value}
                      id={optionId(i)}
                      role="option"
                      aria-selected={i === active}
                      className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 text-[14px] ${i === active ? 'bg-stamp-wash text-ink' : ''}`}
                      onMouseEnter={() => setActive(i)}
                      // Before the input's blur, so the pick lands.
                      onMouseDown={(e) => {
                        e.preventDefault()
                        pick(o.value)
                      }}
                    >
                      <span>
                        {o.value}
                        {o.aka?.length ? <span className="ml-1.5 text-[12px] text-ink-muted">{o.aka.slice(0, 3).join(', ')}</span> : null}
                      </span>
                      {o.detail && <span className="shrink-0 text-[12px] text-ink-muted">{o.detail}</span>}
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
