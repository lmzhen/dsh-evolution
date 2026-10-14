// @tier fast
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PARAM_ALIASES, PARAM_EXPOSURE, PARAM_NAMESPACES, type ParamExposure } from '@deepseek-ai/dsh-evolution-core'
import { readRegistry } from '../../scripts/lib-param-registry.mjs'

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
/** The `why` half of the exposure key (mirrors lib-param-registry.mjs). */
const WHY = ['deployment', 'security', 'identity', 'path', 'install', 'internal']

/** The review group's seed set (design §7.2 G-C, tier split recorded in S1.1). */
const REVIEW_E3 = [
  'reviewSkillInterval', 'reviewMemoryInterval', 'skillReviewTrigger',
  'skillReviewCompletionMinToolCalls', 'reviewEnabled', 'reviewMode', 'reviewWakeInject',
]
const REVIEW_E2 = [
  'reviewProvider', 'reviewTimeoutMs', 'reviewContextMessages', 'reviewMessageChars',
  'reviewMaxDepth', 'reviewToolAllow',
]

// The generators ONE parser, imported rather than mirrored: the mirror this file used to carry went
// stale the moment the declared ending grew a column (independent review P1-3), which is exactly the
// drift this case exists to catch. `readRegistry` is the parser the .mjs generators run.

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
      // The exposure key (0.21.0 / G2): exactly one per row, and the TIER decides which — the same
      // judgement registryViolations makes for the .mjs gates, asserted here against the runtime
      // array so the registry text and the module cannot disagree about it.
      if (entry.tier === 'E3') {
        expect(entry.card, entry.id + ' E3 row carries card').toBe(entry.owner)
        expect(entry.why, entry.id + ' card and why are mutually exclusive').toBeUndefined()
      } else {
        expect(entry.why, entry.id + ' non-E3 row carries why').toBeDefined()
        expect(WHY, entry.id + ' why').toContain(entry.why)
        expect(entry.card, entry.id + ' non-E3 row carries no card').toBeUndefined()
      }
    }
  })

  it('pins the owner→namespace map to its machine-read text (G4/S4.4)', () => {
    const text = readFileSync(join(packagesRoot, 'evolution-core', 'src', 'params.ts'), 'utf8')
    const start = text.indexOf('export const PARAM_NAMESPACES')
    const body = start < 0 ? '' : text.slice(start, text.indexOf('})', start))
    const parsed: Record<string, string> = {}
    for (const line of body.split(/\r?\n/)) {
      const match = /^\s*'([^']+)': '([^']+)',$/.exec(line)
      if (match) parsed[match[1]!] = match[2]!
    }
    // The client-card generator reads this text; a map that only exists in the
    // module would leave the cards describing namespaces that do not exist.
    expect(parsed).toEqual(PARAM_NAMESPACES)
    expect(Object.keys(parsed).length).toBeGreaterThan(0)
  })

  it('treats E3 as the writable tier and everything below it as read-only', () => {
    for (const entry of PARAM_EXPOSURE) {
      if (entry.tier === 'E3' || entry.tier === 'E4') expect(entry.applies, entry.id).not.toBe('none')
      else expect(entry.applies, entry.id).toBe('none')
    }
  })

  it('carries the card metadata on every E3 row and on no other tier (0.7.0)', () => {
    // The settings cards render E3 rows only, so their Chinese label, help text,
    // control kind, unit and value domain live in this registry — the browser half
    // is generated from it. A row without them would render a nameless text box;
    // a non-E3 row carrying them would describe a control no surface draws.
    for (const entry of PARAM_EXPOSURE) {
      if (entry.tier === 'E3') {
        expect(entry.label, entry.id + ' label is Chinese').toMatch(/[\u4e00-\u9fa5]/)
        expect(entry.hint, entry.id + ' hint is Chinese').toMatch(/[\u4e00-\u9fa5]/)
        expect(['number', 'switch', 'select', 'text'], entry.id + ' control').toContain(entry.control)
        expect(entry.unit, entry.id + ' unit is a string').toBeTypeOf('string')
        if (entry.control === 'select') expect(entry.values, entry.id + ' select needs values').not.toBe('')
        else expect(entry.values, entry.id + ' values only for select').toBe('')
      } else {
        expect(entry.label, entry.id + ' has no card surface').toBeUndefined()
        expect(entry.control, entry.id + ' has no card surface').toBeUndefined()
      }
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
    // `readRegistry`'s return type resolves to an ERROR type in this file's linter program (the
    // module's declarations are opaque there); the call is exercised at runtime by this very test.
    // oxlint-disable-next-line typescript/no-unsafe-call, typescript/no-unsafe-member-access
    const parsed = readRegistry(packagesRoot).entries as ParamExposure[]
    expect(parsed.length, 'entries found in the text').toBe(PARAM_EXPOSURE.length)
    expect(parsed).toEqual([...PARAM_EXPOSURE])
  })
})
