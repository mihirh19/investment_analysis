import type { CropKey } from '@shared/farm'

/**
 * Minimum support prices, ₹ per quintal, from the Ministry of Agriculture's MSP statement
 * (desagri.gov.in, as on 12.12.2025) and, where it is already published, Kharif 2026-27. Crops
 * without an MSP (cumin, castor, coriander, fennel, onion, garlic, potato) are left out.
 */
export const MSP: Partial<Record<CropKey, { price: number; season: string }>> = {
  GROUNDNUT: { price: 7517, season: 'Kharif 2026-27' },
  BAJRA: { price: 2900, season: 'Kharif 2026-27' },
  JOWAR: { price: 4023, season: 'Kharif 2026-27' },
  MAIZE: { price: 2410, season: 'Kharif 2026-27' },
  // Medium staple kapas; long staple is ₹8,110.
  COTTON: { price: 7710, season: 'Kharif 2025-26' },
  TUR: { price: 8000, season: 'Kharif 2025-26' },
  MOONG: { price: 8768, season: 'Kharif 2025-26' },
  URAD: { price: 7800, season: 'Kharif 2025-26' },
  SESAME: { price: 9846, season: 'Kharif 2025-26' },
  SOYBEAN: { price: 5328, season: 'Kharif 2025-26' },
  WHEAT: { price: 2585, season: 'Rabi 2026-27' },
  CHANA: { price: 5875, season: 'Rabi 2026-27' },
  MUSTARD: { price: 6200, season: 'Rabi 2026-27' }
}
