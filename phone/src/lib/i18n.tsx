import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { CROPS, type CropKey } from '@shared/farm'
import { fill, translate, type Lang } from './lang'

export type { Lang } from './lang'

const KEY = 'fp:lang'

interface LangApi {
  lang: Lang
  setLang(l: Lang): void
  t(s: string, vars?: Record<string, string | number>): string
  crop(k: CropKey): string
}

const Ctx = createContext<LangApi>({ lang: 'en', setLang: () => {}, t: (s, v) => fill(s, v), crop: (k) => CROPS[k].label })

function stored(): Lang {
  try {
    return localStorage.getItem(KEY) === 'gu' ? 'gu' : 'en'
  } catch {
    return 'en'
  }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, set] = useState<Lang>(stored)
  const api = useMemo<LangApi>(
    () => ({
      lang,
      setLang(l) {
        set(l)
        try {
          localStorage.setItem(KEY, l)
        } catch {
          // Kept for this visit only.
        }
      },
      t: (s, vars) => translate(lang, s, vars),
      crop: (k) => (lang === 'gu' ? CROPS[k].gu : CROPS[k].label)
    }),
    [lang]
  )
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export const useLang = () => useContext(Ctx)
