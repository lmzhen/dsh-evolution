// @tier pre-tag
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { mergeDoctor, mergeDoctorAvailability } from '../../src/doctor.ts'

it('a missing merge section fails with E-325 instead of an empty section', () => {
  expect(mergeDoctorAvailability(false)).toEqual({ ok: false, code: 'E-325' })
  expect(mergeDoctorAvailability(true)).toEqual({ ok: true })
})

it('RG6 doctor covers state, schema, quarantine, tree, consistency, models, staging', async () => {
  const home = await tempRoot('dsh-rg6-doctor-')
  await mkdir(join(home, 'merge', 'journals'), { recursive: true })
  await writeFile(join(home, 'merge', 'recovery.json'), JSON.stringify([{ runId: 'r', ok: true }]))
  const rows = await mergeDoctor(nodeEvolutionIo(), home)
  const keys = rows.map(row => row.key)
  for (const key of ['state', 'merge-state-v3', 'quarantine', 'tree-lock', 'backup', 'target-claim', 'runs', 'install', 'consistency', 'models', 'staging', 'staging-path', 'recovery']) expect(keys, key).toContain(key)
  expect(rows.find(row => row.key === 'state')?.status).toBe('ok')
  expect(rows.find(row => row.key === 'models')?.status).toBe('warn')
})
