import { useData } from '../lib/data'
import { Card, lakhCrore, Trend } from '../ui'

/** The forecast from the desktop: where the money leads, in rupees of then and of today. */
export function Plan() {
  const { snapshot } = useData()
  const f = snapshot?.forecast
  if (!f) return null
  const last = f.years.at(-1)
  if (!last) return null
  const milestones = f.years.filter((y, i) => i === 0 || y.year % 5 === 0 || i === f.years.length - 1)
  return (
    <>
      <Card>
        <div className="text-[14px] text-ink-muted">In {last.year} your money could be</div>
        <div className="wide num text-left text-[38px] leading-tight font-semibold">{lakhCrore(last.nominal)}</div>
        <div className="text-[15px]">
          <span className="num font-semibold">{lakhCrore(last.real)}</span> in today&rsquo;s money
        </div>
        {f.personalInflation !== null && (
          <div className="text-[14px] text-ink-muted">
            {lakhCrore(last.realPersonal)} by your own costs, rising {(f.personalInflation * 100).toFixed(1)}% a year
          </div>
        )}
        <div className="mt-3">
          <Trend values={f.years.map((y) => y.nominal)} height={90} />
        </div>
        <p className="mt-2 text-[13px] text-ink-muted">
          Between {lakhCrore(last.low)} and {lakhCrore(last.high)} if returns run {f.plan.spread} points lower or higher.
        </p>
      </Card>
      <Card title="Year by year">
        <ul>
          {milestones.map((y) => (
            <li key={y.year} className="flex items-baseline justify-between border-b border-rule py-2 text-[15px] last:border-0">
              <span>
                {y.year}
                {y.ages.length > 0 && <span className="ml-2 text-[12px] text-ink-muted">{y.ages.map((a) => `${a.name} ${a.age}`).join(', ')}</span>}
              </span>
              <span className="num">
                {lakhCrore(y.nominal)} <span className="text-[12px] text-ink-muted">({lakhCrore(y.real)} today)</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
      {f.retirement && (
        <Card title={`Retiring in ${f.retirement.year}`}>
          <div className="grid grid-cols-2 gap-3 text-[14px]">
            <div>
              <div className="text-ink-muted">Needed</div>
              <div className="num text-left text-[18px] font-semibold">{lakhCrore(f.retirement.needed)}</div>
            </div>
            <div>
              <div className="text-ink-muted">Projected</div>
              <div className={`num text-left text-[18px] font-semibold ${f.retirement.projected >= f.retirement.needed ? 'text-gain' : 'text-loss'}`}>
                {lakhCrore(f.retirement.projected)}
              </div>
            </div>
          </div>
          <p className="mt-2 text-[14px]">
            {f.retirement.lastsUntil ? `The money runs out in ${f.retirement.lastsUntil}.` : `The money lasts past ${f.plan.targetYear}.`}
          </p>
        </Card>
      )}
      {f.goals.length > 0 && (
        <Card title="Goals">
          <ul>
            {f.goals.map((g) => (
              <li key={g.id} className="flex justify-between border-b border-rule py-2 text-[15px] last:border-0">
                <span>
                  {g.name} <span className="text-[13px] text-ink-muted">{g.year}</span>
                </span>
                <span className={`num ${g.funded === false ? 'text-loss' : ''}`}>{lakhCrore(g.costThen)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="px-2 pb-4 text-[13px] text-ink-muted">Change the plan on the computer: Forecast &amp; inflation.</p>
    </>
  )
}
