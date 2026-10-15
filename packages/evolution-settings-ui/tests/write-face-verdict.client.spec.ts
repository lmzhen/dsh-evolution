// @tier pre-tag
// @vitest-environment jsdom
// G4/4.1 (C-06/S5-04): the write face must report the HOST's verdict.
//
// The defect this pins (measured 2026-10-15): both methods called the seat and then answered a
// CONSTANT `true`, so a refusal the platform reported was recorded as an accepted write. The
// docblock above them already claimed they returned the verdict - the code did not.
import { describe, expect, it } from 'vitest'
import { writeFaceFor } from '../src/client/source.ts'

const seat = (verdict: boolean) => ({
  getSnapshot: () => ({ status: 'ready' }),
  subscribe: () => () => {},
  set: async () => verdict,
  unset: async () => verdict,
  mutate: async () => verdict,
})
type Probe = Parameters<typeof writeFaceFor>[0]
const probeOf = (verdict: boolean) => (() => ({ get: () => seat(verdict) })) as unknown as Probe

describe('G4/4.1: the write face reports the host verdict', () => {
  it('a refused write stays refused (the wrapper used to answer true regardless)', async () => {
    const face = writeFaceFor(probeOf(false), 'evolution-curator')
    expect(await face.mutateOnce([])).toBe(false)
    expect(await face.clear('x')).toBe(false)
  })

  it('an accepted write reports true, and a missing seat reports false', async () => {
    expect(await writeFaceFor(probeOf(true), 'evolution-curator').mutateOnce([])).toBe(true)
    expect(await writeFaceFor((() => undefined) as unknown as Probe, 'evolution-curator').mutateOnce([])).toBe(false)
  })
})
