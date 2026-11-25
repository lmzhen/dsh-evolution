// @tier fast
import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeEvolutionIo } from '../src/io.ts'
import { emptyRunIndex, runStorePortIfV2 } from '../src/run-registry.ts'
import { STATE_V2_MIGRATION_MARKER } from '../src/state/constants.ts'
import { tempRoot } from '../../test-support/temp-home.ts'

describe('run registry surface adapter', () => {
  it('uses the mounted evolutionStore commands for read and write', async () => {
    const home = await tempRoot('dsh-run-service-')
    await mkdir(join(home, 'state'), { recursive: true })
    await writeFile(join(home, 'state', STATE_V2_MIGRATION_MARKER), '{}\n')
    const calls: string[] = []
    const fake = {
      query: async (commandId: string) => {
        calls.push('query:' + commandId)
        return { snapshot: { domains: { runs: emptyRunIndex() } } }
      },
      command: async (request: { commandId: string; change: (current: { domains: { runs?: unknown } }) => Record<string, unknown> | Promise<Record<string, unknown>> }) => {
        calls.push('command:' + request.commandId)
        await request.change({ domains: { runs: emptyRunIndex() } })
      },
    }
    const port = runStorePortIfV2({ get: () => fake }, nodeEvolutionIo(), home)
    expect(await port?.read()).toEqual(emptyRunIndex())
    await port?.write(current => ({ ...(current ?? emptyRunIndex()), runs: [] }))
    expect(calls).toEqual(['query:maintain.status', 'command:maintain.handoff'])
  })

  it('resolves the service per operation so an HMR replacement is not frozen', async () => {
    const home = await tempRoot('dsh-run-service-hmr-')
    await mkdir(join(home, 'state'), { recursive: true })
    await writeFile(join(home, 'state', STATE_V2_MIGRATION_MARKER), '{}\n')
    const calls: string[] = []
    const fake = (label: string) => ({
      query: async (commandId: string) => {
        calls.push(label + ':query:' + commandId)
        return { snapshot: { domains: { runs: emptyRunIndex() } } }
      },
      command: async (request: { commandId: string; change: (current: { domains: { runs?: unknown } }) => Record<string, unknown> | Promise<Record<string, unknown>> }) => {
        calls.push(label + ':command:' + request.commandId)
        await request.change({ domains: { runs: emptyRunIndex() } })
      },
    })
    let current = fake('first')
    const port = runStorePortIfV2({ get: () => current }, nodeEvolutionIo(), home)
    await port?.read()
    current = fake('second')
    await port?.read()
    await port?.write(index => index ?? emptyRunIndex())
    expect(calls).toEqual(['first:query:maintain.status', 'second:query:maintain.status', 'second:command:maintain.handoff'])
  })
})
