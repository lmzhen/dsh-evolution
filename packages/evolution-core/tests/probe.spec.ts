import { expect, it } from 'vitest'
import { isAbsent, isPresent, isUnknown, mapProbe, probeAbsent, probePresent, probeUnknown, valueOr } from '@deepseek-ai/dsh-evolution-core'

/** The union must keep all three outcomes distinguishable: a test that only
 * checks "present vs absent" would pass on a two-state implementation. */
it('Probe keeps present / absent / unknown distinguishable', () => {
  const present = probePresent([1, 2])
  expect(isPresent(present)).toBe(true)
  expect(valueOr(present, [])).toEqual([1, 2])

  const absent = probeAbsent<string[]>()
  expect(isAbsent(absent)).toBe(true)
  expect(isPresent(absent)).toBe(false)
  expect(valueOr(absent, [])).toEqual([])

  const unknown = probeUnknown<string[]>('store unreadable')
  expect(isUnknown(unknown)).toBe(true)
  expect(isAbsent(unknown)).toBe(false)
  expect(isPresent(unknown)).toBe(false)
  // Read failure must NOT read as "nothing there" — the N14 class.
  expect(valueOr(unknown, [])).toEqual([])
  expect(unknown.kind === 'unknown' && unknown.reason).toBe('store unreadable')

  expect(mapProbe(probePresent(2), n => n * 3)).toEqual(probePresent(6))
  expect(mapProbe(unknown, n => n)).toEqual(unknown)
  expect(mapProbe(absent, n => n)).toEqual(absent)
})
