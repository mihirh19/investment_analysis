import { describe, expect, it } from 'vitest'
import { translate } from '../phone/src/lib/lang'
import { FARM_COST_KINDS, SEASON_LABELS } from '../src/shared/farm'

describe('the phone in Gujarati', () => {
  it('translates with values filled in, and falls back to English', () => {
    expect(translate('gu', 'Record a sale')).toBe('વેચાણ નોંધો')
    expect(translate('gu', 'How much ({q} in stock)', { q: '12 ક્વિ.' })).toBe('કેટલું (12 ક્વિ. સ્ટોકમાં)')
    expect(translate('en', 'How much ({q} in stock)', { q: '12 qtl' })).toBe('How much (12 qtl in stock)')
    expect(translate('gu', 'Something new')).toBe('Something new')
  })

  it('has every cost kind and season in Gujarati', () => {
    for (const label of [...Object.values(FARM_COST_KINDS), ...Object.values(SEASON_LABELS)]) expect(translate('gu', label), label).not.toBe(label)
  })
})
