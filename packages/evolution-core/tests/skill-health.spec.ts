import { expect, it } from 'vitest'
import { assessStructureHealth, DEFAULT_HEALTH_THRESHOLDS } from '@deepseek-ai/dsh-evolution-core'

it('a small dense body with support files is healthy', () => {
  const assessment = assessStructureHealth({
    skillName: 'ok-skill',
    bodyChars: 5_000,
    bodyText: '# Ok\n\nRun it. Verify it.',
    supportGroups: 1,
  })
  expect(assessment.verdict).toBe('healthy')
  expect(assessment.reasons).toEqual([])
})

it('body above the soft limit warns, at 2x it demands restructure (rc.73 A1)', () => {
  const warn = assessStructureHealth({ skillName: 'w', bodyChars: DEFAULT_HEALTH_THRESHOLDS.softBodyChars + 1, supportGroups: 1 })
  expect(warn.verdict).toBe('warn')
  expect(warn.reasons[0]).toContain('above the soft limit')
  const needs = assessStructureHealth({ skillName: 'n', bodyChars: DEFAULT_HEALTH_THRESHOLDS.softBodyChars * 2, supportGroups: 1 })
  expect(needs.verdict).toBe('needs-restructure')
  expect(needs.reasons[0]).toContain('2x the soft limit')
})

it('stamp density flags log-like content in the body', () => {
  const lines = [
    '# Log',
    '- rc.67 fixed X',
    '- rc.68 fixed Y',
    '- rc.69 fixed Z',
    '- commit abc1234 did more',
    'done',
  ].join('\n')
  const assessment = assessStructureHealth({ skillName: 'log', bodyChars: 500, bodyText: lines, supportGroups: 0 })
  expect(assessment.verdict).toBe('warn')
  expect(assessment.dims.stampDensityPerKb).not.toBeNull()
  expect(assessment.reasons.some(reason => reason.includes('stamp density'))).toBe(true)
})

it('a large body with no support groups is flagged as scatter', () => {
  const assessment = assessStructureHealth({ skillName: 's', bodyChars: DEFAULT_HEALTH_THRESHOLDS.softBodyChars / 2, supportGroups: 0 })
  expect(assessment.verdict).toBe('warn')
  expect(assessment.reasons[0]).toContain('NO support files')
})

it('custom thresholds drive the same rules', () => {
  const assessment = assessStructureHealth({ skillName: 't', bodyChars: 2_500, supportGroups: 0 }, { softBodyChars: 1_000, stampDensityPerKb: 5 })
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
  expect(ghost.reasons.some(reason => reason.includes('never read'))).toBe(true)
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
  expect(read.reasons.some(reason => reason.includes('never read'))).toBe(false)
})
