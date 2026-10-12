/**
 * G2 S3: the migrated curator must actually USE the mounted platform backend, and must keep working
 * when only the default backend exists. The call count is the evidence — "switched backend" is
 * otherwise only a statement about source code.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { EvolutionCurator } from '../src/index.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function withHome<T>(run: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-curator-fs-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try { return await run(home) } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

describe('G2 S3: the curator prefers the platform backend when the deployment mounts one', () => {
  it('serves its reads through the fs provider, and works without it', async () => {
    await withHome(async () => {
      const base = nodeEvolutionIo()
      const content = '---\nname: demo\ndescription: Demo.\n---\n\n# Demo\n'

      // Deployment A: only the default backend.
      const onlyNode = new Context()
      await onlyNode.plugin(EvolutionIoRegistry)
      await onlyNode.plugin(NodeIo)
      const a = new EvolutionCurator(onlyNode, { autoStart: false })
      await a.skills.create('demo', content, 'foreground')
      // A dry run is the curator's real io path: it scans the tree, reads bodies and writes nothing.
      await a.run({ dryRun: true, ignoreGates: true })
      a.stop()

      // Deployment B: node stays the default AND a platform backend is mounted.
      let fsCalls = 0
      const withFs = new Context()
      await withFs.plugin(EvolutionIoRegistry)
      await withFs.plugin(NodeIo)
      withFs.evolutionIo.registerProvider({
        name: 'fs',
        ...base,
        readText: async (path) => { fsCalls += 1; return base.readText(path) },
        list: async (path) => { fsCalls += 1; return base.list(path) },
        writeText: async (path, text) => { fsCalls += 1; return base.writeText(path, text) },
        exists: async (path) => { fsCalls += 1; return base.exists(path) },
        size: async (path) => { fsCalls += 1; return base.size ? base.size(path) : null },
      })
      const b = new EvolutionCurator(withFs, { autoStart: false })
      await b.skills.create('demo', content, 'foreground')
      await b.run({ dryRun: true, ignoreGates: true })
      expect(fsCalls).toBeGreaterThan(0)
      b.stop()
    })
  })
})
