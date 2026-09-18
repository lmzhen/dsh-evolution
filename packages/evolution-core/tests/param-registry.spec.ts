import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PARAM_ALIASES, PARAM_EXPOSURE, type ParamExposure } from '@deepseek-ai/dsh-evolution-core'

/**
 * G1/S1.1 guard for the parameter registry. It pins two things the .mjs tools
 * cannot: the runtime array's own invariants, and the MACHINE-READ CONTRACT —
 * the one-entry-per-line text the generators parse must describe exactly this
 * array. A registry edit that breaks either side fails here.
 */
const GROUPS = ['library', 'write-caps', 'review', 'memory', 'curator', 'deployment', 'internal']
const TIERS = ['E0', 'E1', 'E2', 'E3', 'E4']
const AUTHORITIES = ['code', 'cordis', 'install']
const APPLIES = ['live', 'restart', 'none']

/** The review group's seed set (design §7.2 G-C, tier split recorded in S1.1). */
const REVIEW_E3 = [
  'reviewSkillInterval', 'reviewMemoryInterval', 'skillReviewTrigger',
  'skillReviewCompletionMinToolCalls', 'reviewEnabled', 'reviewMode', 'reviewWakeInject',
]
const REVIEW_E2 = [
  'reviewProvider', 'reviewTimeoutMs', 'reviewContextMessages', 'reviewMessageChars',
  'reviewMaxDepth', 'reviewToolAllow',
]

/** Parse the registry text the .mjs generators read (one entry per line). */
function parseRegistryText(text: string): ParamExposure[] {
  const out: ParamExposure[] = []
  const entry = new RegExp(
    "^\\s*\\{ id: '([^']+)', group: '([^']+)', tier: '([^']+)', authority: '([^']+)', "
    + "owner: '([^']+)', applies: '([^']+)', docAnchor: '([^']+)', summary: '([^']*)' \\},$",
  )
  for (const line of text.split(/\r?\n/)) {
    const match = entry.exec(line)
    if (!match) continue
    out.push({
      id: match[1]!, group: match[2] as ParamExposure['group'], tier: match[3] as ParamExposure['tier'],
      authority: match[4] as ParamExposure['authority'], owner: match[5]!,
      applies: match[6] as ParamExposure['applies'], docAnchor: match[7]!, summary: match[8]!,
    })
  }
  return out
}

/** The packages root: these specs run from <root>/evolution-core/tests. */
const packagesRoot = fileURLToPath(new URL('../../', import.meta.url))

describe('parameter registry (G1/S1.1)', () => {
  it('carries only complete, enum-valid entries with unique canonical ids', () => {
    const ids = new Set<string>()
    for (const entry of PARAM_EXPOSURE) {
      // Bare camelCase ids by default; `<package>.<field>` when the same field name
      // exists in several rows (paths, providers, enable switches, session scoping).
      expect(entry.id).toMatch(/^([a-z][a-z0-9-]*\.)?[a-z][A-Za-z0-9]*$/)
      expect(ids.has(entry.id), entry.id + ' is unique').toBe(false)
      ids.add(entry.id)
      expect(GROUPS, entry.id + ' group').toContain(entry.group)
      expect(TIERS, entry.id + ' tier').toContain(entry.tier)
      expect(AUTHORITIES, entry.id + ' authority').toContain(entry.authority)
      expect(APPLIES, entry.id + ' applies').toContain(entry.applies)
      expect(entry.owner, entry.id + ' owner is named').not.toBe('')
      expect(existsSync(join(packagesRoot, entry.owner)), entry.id + ' owner package exists').toBe(true)
      expect(entry.docAnchor, entry.id + ' docAnchor').toMatch(/^PARAMETERS\.md#/)
      expect(entry.summary.length, entry.id + ' summary').toBeGreaterThan(10)
      // The registry names canonical ids; a deprecated alias is never an id.
      expect(PARAM_ALIASES[entry.id], entry.id + ' is canonical').toBeUndefined()
    }
  })

  it('treats E3 as the writable tier and everything below it as read-only', () => {
    for (const entry of PARAM_EXPOSURE) {
      if (entry.tier === 'E3' || entry.tier === 'E4') expect(entry.applies, entry.id).not.toBe('none')
      else expect(entry.applies, entry.id).toBe('none')
    }
  })

  it('seeds the review group with the recorded tier split', () => {
    const review = PARAM_EXPOSURE.filter(entry => entry.group === 'review')
    expect(review.map(entry => entry.id).sort()).toEqual([...REVIEW_E3, ...REVIEW_E2].sort())
    for (const entry of review) {
      expect(entry.tier, entry.id).toBe(REVIEW_E3.includes(entry.id) ? 'E3' : 'E2')
    }
  })

  it('keeps the parsed text and the runtime array in agreement', () => {
    const source = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'params.ts'), 'utf8')
    const parsed = parseRegistryText(source)
    expect(parsed.length, 'entries found in the text').toBe(PARAM_EXPOSURE.length)
    expect(parsed).toEqual([...PARAM_EXPOSURE])
  })
})
