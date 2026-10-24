// @tier pre-tag
import { expect, it } from 'vitest'
import { newRunRegistry, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'

it('cancel affects only the requested merge run, never other kinds', async () => {
  const home = await tempRoot('dsh-rg6-cancel-')
  const registry = newRunRegistry({ io: nodeEvolutionIo(), home, now: () => 1 })
  const merge = await registry.begin('merge', { command: 'scan' })
  const maintenance = await registry.begin('maintain')
  expect(registry.cancel(merge.id)).toBe(true)
  expect(registry.find(merge.id)?.state).toBe('cancelled')
  expect(registry.find(maintenance.id)?.state).toBe('running')
  expect(registry.cancel('missing')).toBe(false)
})
