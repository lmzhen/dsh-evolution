// @tier fast
import { expect, it } from 'vitest'
import { en, zh } from '../src/client/messages.ts'

it('maps the command surfaces to the three queue labels', () => {
  expect(zh['tab.verify']).toBe('待判断')
  expect(zh['tab.fuse']).toBe('待合并')
  expect(zh['tab.pending']).toBe('待批准')
})

it('zh and en have the same complete key set', () => {
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  expect(enKeys).toEqual(zhKeys)
  expect(zhKeys).toEqual(expect.arrayContaining([
    'stage.screening', 'stage.settle', 'origin.system',
    'failureWireVersion', 'failureBadQuery', 'failureBodyMissing', 'failureRefused',
    'settings.title', 'settings.mergeApproval', 'settings.platformWrite', 'settings.capabilityMissing',
    'run.endedAt', 'run.failure', 'run.report', 'run.resultRef',
    'stage.state.lost', 'stage.state.expired',
    'history.reason.target-taken', 'history.reason.validation-failed', 'history.reason.merge-over-limit',
  ]))
  expect(zh['history.reason.merge-over-limit']).toBe('融合后超出字数上限')
  expect(zh['settings.mergeApproval']).toContain('技能自动合并')
  expect(zh['settings.platformWrite']).toContain('写入审批')
  expect(zh['settings.hint']).toContain('两轮合并工作流')
})
