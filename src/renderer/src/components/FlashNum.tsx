import { useFlash } from '../lib/motion'

/** A number that flashes green or red for a moment when a live price moves it. */
export function FlashNum({ value, text, className = '' }: { value: number | null; text: string; className?: string }) {
  const flash = useFlash(value)
  return (
    <span key={flash.key} className={`-mx-0.5 rounded-sm px-0.5 ${flash.className} ${className}`}>
      {text}
    </span>
  )
}
