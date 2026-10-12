/**
 * G2 S3: feedback persists through skill-usage's io, and that path writes through the RMW entry point
 * (`mutateUsage` → `transact`) — so the counter wraps `transact` as well. It also has to let the
 * plugin's `ctx.inject(['evolutionIo'], …)` fire first: `record()` takes no io and no-ops until
 * `attachIo` has run, which is why an immediate record() after `plugin(Feedback)` writes nothing.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import SkillUsageRegistry from '@deepseek-ai/dsh-skill-usage'
import * as Feedback from '../src/index.ts'
import { join } from 'node:path'
import { tempHome } from '../../test-support/temp-home.ts'

const settle = () => new Promise(resolve => setTimeout(resolve, 20))

describe('G2 S3: feedback persists through the platform backend when the deployment mounts one', () => {
  it('records with the fs provider mounted, and works without it', async () => {
    const home = await tempHome('dsh-feedback-io-')

    const onlyNode = new Context()
    await onlyNode.plugin(EvolutionIoRegistry)
    await onlyNode.plugin(NodeIo)
    await onlyNode.plugin(SkillUsageRegistry, { root: join(home, 'skills') })
    await onlyNode.plugin(Feedback)
    await settle() // let the plugin's inject attach its io before anything is recorded
    // Deployment A is a smoke path only: `score()` semantics need a prior usage record, so gating on it
    // would fail for reasons unrelated to the seam (and silently mask the counter assertions below).
    onlyNode.evolutionFeedback.record('demo', 'positive', undefined, 'skill')
    await onlyNode.evolutionFeedback.waitIdle()

    let fsCalls = 0
    const base = nodeEvolutionIo()
    const withFs = new Context()
    await withFs.plugin(EvolutionIoRegistry)
    await withFs.plugin(NodeIo)
    await withFs.plugin(SkillUsageRegistry, { root: join(home, 'skills') })
    withFs.evolutionIo.registerProvider({
      name: 'fs',
      ...base,
      readText: async (path) => { fsCalls += 1; return base.readText(path) },
      list: async (path) => { fsCalls += 1; return base.list(path) },
      writeText: async (path, text) => { fsCalls += 1; return base.writeText(path, text) },
      exists: async (path) => { fsCalls += 1; return base.exists(path) },
      transact: async (path, task) => { fsCalls += 1; return base.transact!(path, task) },
    })
    // Isolate the plumbing first: the registered backend must be resolvable and its counter live.
    const registered = withFs.evolutionIo.provider('fs')
    await registered.writeText(join(home, 'probe.txt'), 'x')
    expect(fsCalls).toBeGreaterThan(0)
    fsCalls = 0

    await withFs.plugin(Feedback)
    await settle()
    withFs.evolutionFeedback.record('demo', 'negative', undefined, 'skill')
    await withFs.evolutionFeedback.waitIdle()
    await settle()
    expect(fsCalls).toBeGreaterThan(0)
  })
})
