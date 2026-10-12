import { expect, it } from 'vitest'
import { assessStructureHealth, DEFAULT_HEALTH_THRESHOLDS, HEALTH_STAMP_RE } from '@deepseek-ai/dsh-evolution-core'

it('a small dense body with support files is healthy', () => {
  const assessment = assessStructureHealth({
    skillName: 'ok-skill',
    bodyChars: 5_000,
    bodyText: '# Ok\n\nRun it. Verify it.',
    supportGroups: 1,
  })
  expect(assessment.verdict).toBe('healthy')
  expect(assessment.findings).toEqual([])
})

it('judges the borrowed char line on the token scale (V6)', () => {
  // No body text: the character line decides (an absent measurement is never a pass).
  const blind = assessStructureHealth({ skillName: 'b', bodyChars: DEFAULT_HEALTH_THRESHOLDS.softBodyChars + 1, supportGroups: 1 })
  expect(blind.verdict).toBe('warn')
  expect(blind.findings.map(f => f.rule)).toContain('body-oversize')
  const blindNeeds = assessStructureHealth({ skillName: 'bn', bodyChars: DEFAULT_HEALTH_THRESHOLDS.softBodyChars * 2, supportGroups: 1 })
  expect(blindNeeds.verdict).toBe('needs-restructure')
  expect(blindNeeds.findings.map(f => f.rule)).toContain('body-oversize-2x')
  // With body text the judgment runs in tokens against the per-body line; the two
  // scripts sit on their OWN line at 20k characters, which is the upstream trigger.
  const cjkAt = '中'.repeat(DEFAULT_HEALTH_THRESHOLDS.softBodyChars)
  const cjkUnder = '中'.repeat(DEFAULT_HEALTH_THRESHOLDS.softBodyChars - 10)
  const asciiAt = 'a'.repeat(DEFAULT_HEALTH_THRESHOLDS.softBodyChars)
  const atCjk = assessStructureHealth({ skillName: 'c', bodyChars: cjkAt.length, bodyText: cjkAt, supportGroups: 1 })
  // G2 ③: the token-scale evidence used to ride on the reason TEXT. It now has to be an explicit
  // dimension assertion, or deleting `reasons` would quietly drop the invariant it protected.
  const asciiSame = assessStructureHealth({ skillName: 'ax', bodyChars: asciiAt.length, bodyText: asciiAt, supportGroups: 1 })
  expect(atCjk.dims.bodyTokens).toBeGreaterThan(asciiSame.dims.bodyTokens)
  expect(assessStructureHealth({ skillName: 'cu', bodyChars: cjkUnder.length, bodyText: cjkUnder, supportGroups: 1 }).verdict).toBe('healthy')
  // Same character count, other script: it is at its OWN token line, so it is flagged too —
  // the token-scale evidence now lives on the dims assertion above (L32), not in reason text.
  expect(assessStructureHealth({ skillName: 'a', bodyChars: asciiAt.length, bodyText: asciiAt, supportGroups: 1 }).verdict).toBe('warn')
})

it('stamp density flags log-like content in a large body', () => {
  const pad = 'Ordinary upkeep note: the body stays scannable for future agents. '.repeat(29)
  const lines = [
    '# Log',
    pad,
    '- rc.61 fixed A',
    '- rc.62 fixed B',
    '- rc.63 fixed C',
    '- rc.64 fixed D',
    '- rc.65 fixed E',
    '- rc.66 fixed F',
    '- rc.67 fixed G',
    '- commit abc1234 did more',
    'done',
  ].join('\n')
  const assessment = assessStructureHealth({ skillName: 'log', bodyChars: lines.length, bodyText: lines, supportGroups: 0 })
  expect(assessment.verdict).toBe('warn')
  expect(assessment.dims.stampDensityPerKb).not.toBeNull()
  expect(assessment.findings.map(f => f.rule)).toContain('stamp-density')
})

it('short bodies skip stamp density — a few dates are ordinary documentation (audit X1)', () => {
  const body = '# Ok\n\nUpdated on 2026-08-30. Also 2026-08-31.\n'
  const assessment = assessStructureHealth({ skillName: 'short', bodyChars: body.length, bodyText: body, supportGroups: 1 })
  expect(assessment.verdict).toBe('healthy')
  expect(assessment.dims.stampDensityPerKb).toBeNull()
})

it('a large body with no support groups is flagged as scatter', () => {
  const assessment = assessStructureHealth({ skillName: 's', bodyChars: DEFAULT_HEALTH_THRESHOLDS.softBodyChars / 2, supportGroups: 0 })
  expect(assessment.verdict).toBe('warn')
  expect(assessment.findings.map(f => f.rule)).toContain('body-without-support')
})

it('custom thresholds drive the same rules', () => {
  // E3 (v15): explicit all-fields literal — SkillHealthThresholds requires
  // churnMinPatches; the old two-field literal only compiled because test
  // type-coverage let it slip.
  const assessment = assessStructureHealth({ skillName: 't', bodyChars: 2_500, supportGroups: 0 }, { ...DEFAULT_HEALTH_THRESHOLDS, softBodyChars: 1_000, stampDensityPerKb: 5, churnMinPatches: DEFAULT_HEALTH_THRESHOLDS.churnMinPatches })
  expect(assessment.verdict).toBe('needs-restructure')
})

it('churn dimension warns when patched many times but never read (A2 write-ghost)', () => {
  const thresholds = { ...DEFAULT_HEALTH_THRESHOLDS, churnMinPatches: 20 }
  const ghost = assessStructureHealth({
    skillName: 'ghost',
    bodyChars: 500,
    supportGroups: 1,
    patchCount: 30,
    readCount: 0,
  }, thresholds)
  expect(ghost.verdict).toBe('warn')
  expect(ghost.findings.map(f => f.rule)).toContain('write-ghost')
  expect(ghost.dims.churnPatches).toBe(30)
  expect(ghost.dims.churnReads).toBe(0)
})

it('churn dimension ignores usage when counts are absent or the skill is read', () => {
  const thresholds = { ...DEFAULT_HEALTH_THRESHOLDS, churnMinPatches: 20 }
  const noCounts = assessStructureHealth({ skillName: 'n', bodyChars: 500, supportGroups: 1 }, thresholds)
  expect(noCounts.verdict).toBe('healthy')
  expect(noCounts.dims.churnPatches).toBeNull()
  const read = assessStructureHealth({
    skillName: 'r',
    bodyChars: 500,
    supportGroups: 1,
    patchCount: 40,
    readCount: 3,
  }, thresholds)
  expect(read.verdict).toBe('healthy')
  expect(read.findings.map(f => f.rule)).not.toContain('write-ghost')
})

it('F-320: HEALTH_STAMP_RE counts offset/non-UTC timestamps and hex-with-digits, not English hex words', () => {
  // Offset and no-timezone ISO timestamps must be counted; the old regex only
  // matched a UTC `Z` suffix (or a bare date), so +08:00 log lines were missed.
  expect((('line 2026-08-31T12:00:00+08:00 and 2026-08-31T12:00:00 and 2026-08-30').match(HEALTH_STAMP_RE) ?? []).length).toBe(3)
  // Commit shas have digits; coincidental all-letter hex words must not count.
  const body = 'commit abc1234 did work; the word defaced and feedback appeared; rc.41 done'
  expect((body.match(HEALTH_STAMP_RE) ?? []).length).toBe(2) // abc1234 + rc.41
})
