import { useState } from 'react'
import { ErrorNote } from './Shell'
import { Button, Input } from './ui'
import { useForgetPdfPasswords, usePanInfo, usePdfPasswordCount, useSetPersonPan } from '../lib/api'

/**
 * Settings: the PAN of each person, the password on most depository, broker and contract-note PDFs.
 * It is kept encrypted on this computer and tried on every PDF from Gmail or a file you pick, along
 * with the passwords remembered from earlier files; a PDF with its own password gets it typed once.
 */
export function PdfPasswords() {
  const pans = usePanInfo()
  const save = useSetPersonPan()
  const saved = usePdfPasswordCount()
  const forget = useForgetPdfPasswords()
  const [typed, setTyped] = useState<Record<number, string>>({})
  const rows = pans.data ?? []
  if (!rows.length) return null
  return (
    <section aria-labelledby="pdf-passwords" className="mb-12 max-w-[880px]">
      <h2 id="pdf-passwords" className="wide mb-2 text-[19px] font-semibold">
        PDF passwords
      </h2>
      <p className="mb-4 max-w-[72ch] text-[14px] text-ink-muted">
        Statements from CDSL, NSDL, Zerodha and most banks open with the PAN. Save each person’s PAN here and it is tried on every PDF
        automatically, in capitals and in lower case. It stays encrypted on this computer and is used only to open your own files.
        A PDF with a different password (a card statement, a CAMS file) is opened by typing its password once, in the box under it
        in the Gmail log or when you pick the file; it is remembered for the next ones.
      </p>
      <ul className="space-y-3">
        {rows.map((p) => (
          <li key={p.personId}>
            <form
              className="flex flex-wrap items-center gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                save.mutate([p.personId, typed[p.personId] ?? ''], { onSuccess: () => setTyped((t) => ({ ...t, [p.personId]: '' })) })
              }}
            >
              <span className="w-28 text-[14px] font-medium">{p.name}</span>
              <Input
                aria-label={`${p.name}’s PAN`}
                className="w-44 uppercase"
                placeholder={p.saved ? `Saved, ends ${p.ending}` : 'ABCDE1234F'}
                value={typed[p.personId] ?? ''}
                maxLength={10}
                autoComplete="off"
                onChange={(e) => setTyped((t) => ({ ...t, [p.personId]: e.target.value.toUpperCase() }))}
              />
              <Button type="submit" disabled={!(typed[p.personId] ?? '').trim() || save.isPending}>
                Save PAN
              </Button>
              {p.saved && (
                <Button type="button" variant="danger" onClick={() => confirm(`Forget ${p.name}’s PAN?`) && save.mutate([p.personId, ''])}>
                  Forget
                </Button>
              )}
            </form>
          </li>
        ))}
      </ul>
      {(saved.data ?? 0) > 0 && (
        <p className="mt-3 text-[13px] text-ink-muted">
          {saved.data} other PDF password{saved.data === 1 ? '' : 's'} remembered (encrypted).{' '}
          <button className="text-stamp hover:underline" onClick={() => confirm('Forget the saved PDF passwords? PANs stay.') && forget.mutate([])}>
            Forget them
          </button>
        </p>
      )}
      <ErrorNote error={save.error ?? forget.error} />
    </section>
  )
}
