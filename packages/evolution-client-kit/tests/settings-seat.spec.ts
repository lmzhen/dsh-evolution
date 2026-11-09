// @tier fast
// The settings card must name the RIGHT cause when the host refuses a write: a revision CAS loss
// (409) is "another page changed this", an invalid value (400 invalid config) is not. The seat used
// to throw the body away and answer a bare boolean, so every refusal read as a conflict.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSettingsSeat } from '../src/settings-seat.ts'

const answer = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  json: async () => body,
})

const stub = (mutateAnswer: unknown) => {
  const fetchMock = vi.fn(async (url: string | URL, init?: { method?: string }) => {
    if (init?.method === 'POST') return mutateAnswer
    return answer(200, { ok: true, data: { namespaces: [] } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const saveOf = (status: number, body: unknown): Promise<unknown> => {
  stub(answer(status, body))
  const seat = createSettingsSeat({})
  const form = seat.get('evolution-curator')
  if (form?.save === undefined) throw new Error('seat form has no structured save')
  return form.save([{ op: 'set', path: ['enabled'], value: true }])
}

afterEach(() => { vi.unstubAllGlobals() })

describe('settings seat refusal kind', () => {
  it('reads a 409 as a revision conflict', async () => {
    expect(await saveOf(409, { ok: false, error: 'settings-conflict', expected: 1, actual: 2 })).toEqual({ written: false, kind: 'conflict' })
  })

  it('reads a 400 invalid-config refusal as validation, not a conflict', async () => {
    expect(await saveOf(400, { ok: false, error: 'invalid config:\n  - $.pendingTtlMs expected number >= 0 but got -1' })).toEqual({ written: false, kind: 'validation' })
  })

  it('keeps an unnamed refusal as transport and reports an accepted write as written', async () => {
    expect(await saveOf(400, { ok: false, error: 'namespace-not-allowed' })).toEqual({ written: false, kind: 'transport' })
    expect(await saveOf(200, { ok: true, data: { namespaces: [] } })).toEqual({ written: true })
  })
})

describe('settings seat sharing', () => {
  it('returns one seat and one form per client context', () => {
    const ctx = {}
    const first = createSettingsSeat(ctx)
    const second = createSettingsSeat(ctx)
    expect(second).toBe(first)
    expect(second.get('evolution-curator')).toBe(first.get('evolution-curator'))
    first.dispose()
    expect(createSettingsSeat(ctx)).not.toBe(first)
  })
})
