// @tier fast
import { expect, it } from 'vitest'
import { en, zh } from '../src/client/messages.ts'

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
    'history.reason.target-taken', 'history.reason.validation-failed',
  ]))
})
