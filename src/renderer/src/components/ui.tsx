import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react'

export function Button({
  variant = 'primary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'danger' }) {
  const styles = {
    primary: 'bg-stamp text-white hover:brightness-110 disabled:opacity-50 dark:text-[#10162a]',
    quiet: 'border border-rule-strong text-ink hover:bg-paper disabled:opacity-50',
    danger: 'text-loss hover:bg-loss/10 disabled:opacity-50'
  }[variant]
  return <button className={`rounded-lg px-3.5 py-1.5 text-[15px] font-medium ${styles} ${className}`} {...rest} />
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[14px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-[13px] text-ink-muted">{hint}</span>}
    </label>
  )
}

const inputCls =
  'rounded-lg border border-rule-strong bg-sheet px-2.5 py-1.5 text-[15px] text-ink placeholder:text-ink-muted/70'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ''}`} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${props.className ?? ''}`} />
}
