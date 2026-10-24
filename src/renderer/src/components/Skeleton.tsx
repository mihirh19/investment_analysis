// Grey placeholder blocks shown while a page's numbers are being worked out.

export function Block({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-rule/70 ${className}`} />
}

/** A generic page outline: four figures, a chart and a few table rows. */
export function PageSkeleton({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-label={label}>
      <div className="grid grid-cols-2 gap-x-10 gap-y-4 @2xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="border-t border-rule-strong pt-2">
            <Block className="mb-2 h-3 w-24" />
            <Block className="h-6 w-32" />
          </div>
        ))}
      </div>
      <Block className="mt-12 mb-3 h-5 w-56" />
      <Block className="h-[220px] w-full" />
      <Block className="mt-12 mb-3 h-5 w-48" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex justify-between gap-6 border-b border-rule py-2.5">
          <Block className="h-4 w-1/3" />
          <Block className="h-4 w-24" />
        </div>
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  )
}
