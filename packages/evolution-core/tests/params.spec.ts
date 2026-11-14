// @tier fast
import { describe, expect, it } from 'vitest'
import { PARAM_ALIASES, isDeprecatedParamId, readParam, resolveParamId } from '@deepseek-ai/dsh-evolution-core'

const CANONICAL_IDS = [
  'reviewMemoryInterval', 'reviewSkillInterval', 'curatorIntervalHours',
  'skillContentChars', 'memoryChars', 'userChars',
]

describe('parameter id consolidation (G0/S0.2)', () => {
  it('resolves every deprecated alias to its canonical id', () => {
    expect(resolveParamId('memoryInterval')).toBe('reviewMemoryInterval')
    expect(resolveParamId('skillInterval')).toBe('reviewSkillInterval')
    expect(resolveParamId('intervalHours')).toBe('curatorIntervalHours')
    expect(resolveParamId('maxSkillContentChars')).toBe('skillContentChars')
    expect(resolveParamId('memoryCharLimit')).toBe('memoryChars')
    expect(resolveParamId('userCharLimit')).toBe('userChars')
  })

  it('passes ids without an alias through unchanged', () => {
    for (const id of ['reviewMode', 'staleAfterDays', 'archiveAfterDays', 'maxSkillFileBytes']) {
      expect(resolveParamId(id)).toBe(id)
      expect(isDeprecatedParamId(id)).toBe(false)
    }
  })

  it('keeps the alias table self-consistent (no chains, no duplicate targets)', () => {
    const entries = Object.entries(PARAM_ALIASES)
    expect(entries).toHaveLength(6)
    for (const [alias, canonical] of entries) {
      expect(alias).not.toBe(canonical)
      expect(PARAM_ALIASES[canonical]).toBeUndefined()
      expect(isDeprecatedParamId(alias)).toBe(true)
    }
    expect(new Set(entries.map(([, canonical]) => canonical)).size).toBe(entries.length)
    expect([...CANONICAL_IDS].sort()).toEqual(entries.map(([, c]) => c).sort())
  })

  it('reads only the canonical spelling (alias input resolves, alias carriers do not)', () => {
    expect(readParam({ reviewSkillInterval: 30, skillInterval: 10 }, 'skillInterval')).toBe(30)
    expect(readParam({ skillInterval: 10 }, 'reviewSkillInterval')).toBeUndefined()
    expect(readParam({ skillInterval: 10 }, 'skillInterval')).toBeUndefined()
    expect(readParam({ memoryChars: 2_200 }, 'memoryCharLimit')).toBe(2_200)
    expect(readParam({ reviewSkillInterval: undefined }, 'reviewSkillInterval')).toBeUndefined()
  })

  it('claims nothing when the canonical spelling is absent', () => {
    expect(readParam({}, 'reviewSkillInterval')).toBeUndefined()
    expect(readParam(undefined, 'reviewSkillInterval')).toBeUndefined()
  })
})
