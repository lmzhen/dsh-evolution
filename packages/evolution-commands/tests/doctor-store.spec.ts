// @tier fast
import { expect, it } from 'vitest'
import { runDoctorCommand } from '../src/host-commands/doctor-command.ts'
import { tempHome } from '../../test-support/temp-home.ts'

it('doctor --json includes the v2 store commit when evolutionStore is mounted', async () => {
  await tempHome('dsh-doctor-store-')
  const ctx = {
    get: (name: string): unknown => name === 'evolutionStore'
      ? { query: async () => ({ snapshot: { commitId: 'commit-1', tree: { unitId: 'unit-1' } } }) }
      : undefined,
  }
  const result = await runDoctorCommand({ input: 'doctor --json', ctx: ctx as never, runs: () => ({ running: 0, orphaned: 0 }), locale: 'en' })
  expect(result?.kind).toBe('success')
  const report = JSON.parse(result!.text) as { store?: { commitId: string; treeUnit: string | null } }
  expect(report.store).toEqual({ commitId: 'commit-1', treeUnit: 'unit-1' })
})
