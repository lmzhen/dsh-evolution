// @tier pre-tag
/** G1/1.5 (S7-09): the control-plane lock covers the MUTATION, not the whole pass.
 *
 * The observable is the operator, and the parking spot is the WHOLE-TREE SNAPSHOT - the second thing the
 * plan names as "must not be inside the lock". It runs after the recommendation phase and before the
 * mutation, so gating `skills.snapshotAll` parks the pass in exactly the window that used to hold the
 * mutex end to end. A `restore` issued there must complete; with the lock back around all of runCore it
 * queues behind the parked snapshot and loses the 500ms race.
 *
 * This replaced an LLM-based fixture: that one could not be reproduced outside curator.spec.ts, because
 * whether the recommend pass calls the LLM at all depends on state other cases in that file leave behind.
 * The snapshot needs no candidate pool and no provider - it is the same window, without the dependency. */
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionCurator from '../src/index.ts'
import { tempHome } from '../../test-support/temp-home.ts'

const BODY = (name: string, text: string): string => '---\nname: ' + name + '\ndescription: Demo.\n---\n\n' + text

it('G1/1.5: an operator restore does not wait for a pass parked in its whole-tree snapshot', async () => {
  await tempHome('dsh-curator-lock-scope-')
  const ctx = new Context()
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(EvolutionCurator, { enabled: true, intervalHours: 24 })
  const skills = ctx.evolutionCurator.skills
  await skills.create('restore-me', BODY('restore-me', 'body'), 'foreground')
  await skills.archive('restore-me', {}, 'foreground')
  // Park the pass inside the whole-tree snapshot: it is taken unconditionally on a non-dry run, so this
  // needs neither a nomination pool nor a provider.
  let openGate: (() => void) | undefined
  const gate = new Promise<void>((resolve) => { openGate = resolve })
  let entered = false
  const snapshotAll = skills.snapshotAll.bind(skills)
  // ONLY the first snapshot is gated: `restore` takes its own pre-restore snapshot through this same
  // method, so gating every call parks the operator action on the very gate meant to park the pass -
  // which is exactly how this fixture first failed (6s, no output, restore silently stuck on my own gate).
  skills.snapshotAll = async (...args: Parameters<typeof snapshotAll>) => {
    if (!entered) {
      entered = true
      await gate
    }
    return await snapshotAll(...args)
  }
  const run = ctx.evolutionCurator.run({ ignoreGates: true })
  // The pass is parked. The operator acts now.
  const t0 = Date.now()
  const operator = (async () => {
    for (let i = 0; i < 200 && !entered; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
    const result = await ctx.evolutionCurator.restore('restore-me')
    console.log('PROBE restore ok=' + String(result.ok) + ' ms=' + String(Date.now() - t0) + ' msg=' + String(result.message).slice(0, 90))
    return 'done' as const
  })()
  const raced = await Promise.race([operator, new Promise<'waited'>((resolve) => setTimeout(() => resolve('waited'), 6000))])
  expect(entered).toBe(true)
  expect(raced).toBe('done')
  openGate?.()
  await run
})
