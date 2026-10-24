// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { resolveUnitAuthority } from '../src/unit-recovery.ts'
import { writeUnitSnapshot } from '../src/unit-storage.ts'

it('prefers unit evidence/snapshot over a legacy journal', async () => {
  const home = await tempRoot('dsh-unit-authority-')
  const io = nodeEvolutionIo()
  const unitId = 'run-1:abc'
  expect(await resolveUnitAuthority(io, home, unitId, false)).toBe('none')
  expect(await resolveUnitAuthority(io, home, unitId, true)).toBe('legacy')
  await writeUnitSnapshot(io, home, { schemaVersion: 1, unitId, planDigest: 'd', runId: 'run-1', target: 'a', targetExists: false, targetBefore: null, supportBefore: [], supportAfter: [], sourceBefore: [], origin: 'foreground', summary: 's', createdAt: 1 })
  expect(await resolveUnitAuthority(io, home, unitId, true)).toBe('unit')
})
