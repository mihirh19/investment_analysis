import { useState } from 'react'
import { ErrorNote } from './Shell'
import { Button, Field, Input } from './ui'
import { openExternal, useAisStatus, useRemoveAisKey, useSetAisKey } from '../lib/api'

/** Settings section: the person's own aisstream.io key, for live ships around India on the World map. */
export function AisSettings() {
  const q = useAisStatus()
  const setKey = useSetAisKey()
  const remove = useRemoveAisKey()
  const [key, setKeyText] = useState('')
  const s = q.data
  if (!s) return null
  return (
    <section aria-labelledby="ais" className="mb-12 max-w-[880px]">
      <h2 id="ais" className="wide mb-2 text-[19px] font-semibold">
        Live ships
      </h2>
      <p className="mb-4 max-w-[72ch] text-[14px] text-ink-muted">
        The World map shows ships in the Baltic without any key. To see ships in India’s seas, the Gulf, the Red Sea and
        the Malacca Strait, add your own free key from aisstream.io (it signs in with GitHub). The key is kept encrypted
        on this computer and sent only to aisstream.io, and only while the map’s ships layer is on.
      </p>
      {!s.hasKey ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            setKey.mutate([key], { onSuccess: () => setKeyText('') })
          }}
        >
          <Field label="aisstream.io API key" hint="From aisstream.io → API Keys">
            <Input
              type="password"
              className="w-96"
              value={key}
              onChange={(e) => setKeyText(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Button type="submit" disabled={!key || setKey.isPending}>
            Save key
          </Button>
          <button
            type="button"
            className="mb-2 text-[13px] text-stamp hover:underline"
            onClick={() => void openExternal('https://aisstream.io/')}
          >
            About aisstream.io
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-4 text-[14px]">
          <span>
            Key ending <b className="num">…{s.keyEnding}</b>
          </span>
          <Button variant="danger" onClick={() => confirm('Remove the aisstream.io key?') && remove.mutate([])}>
            Remove key
          </Button>
        </div>
      )}
      <ErrorNote error={setKey.error ?? remove.error} />
    </section>
  )
}
