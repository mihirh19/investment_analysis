import { Button } from './ui'
import { useSaveMonthlyReport } from '../lib/api'

/** Saves this month's family report as a PDF (where the person chooses); says where it went. */
export function ReportButton({ personId }: { personId?: number }) {
  const save = useSaveMonthlyReport()
  return (
    <span className="flex items-center gap-2">
      <Button variant="quiet" className="!px-2.5 !py-0.5 !text-[13px]" disabled={save.isPending} onClick={() => save.mutate(personId)}>
        {save.isPending ? 'Making the PDF…' : 'Monthly report (PDF)'}
      </Button>
      {save.data && <span className="text-[12px] text-ink-muted">Saved to {save.data}</span>}
      {save.error && <span className="text-[12px] text-loss">{String((save.error as Error).message ?? save.error)}</span>}
    </span>
  )
}
