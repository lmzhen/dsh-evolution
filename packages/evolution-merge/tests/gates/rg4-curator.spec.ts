// @tier pre-tag
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { acquireTreeWriteLock, evolutionHome, nodeEvolutionIo, withTreeWriteLock } from '@deepseek-ai/dsh-evolution-core'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionCurator from '@deepseek-ai/dsh-evolution-curator'
import { tempHome } from '../../../test-support/temp-home.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'

it('serializes a curator-style mutation behind the merge tree fence', async () => {
  const home = await tempRoot('dsh-rg4-curator-')
  const io = nodeEvolutionIo()
  const held = await acquireTreeWriteLock({ io, home, waitMs: 0 })
  if (!held.ok) throw new Error('lock failed')
  let ran = false
  const waiting = withTreeWriteLock({ io, home, waitMs: 2_000 }, async () => { ran = true; return 'curated' })
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(ran).toBe(false)
  await held.lock.release()
  expect(await waiting).toEqual({ ok: true, value: 'curated' })
  expect(ran).toBe(true)
})

it('curator apply is wired to the same tree lock', async () => {
  const source = await readFile(join(process.cwd(), 'packages/evolution/evolution-curator/src/index.ts'), 'utf8')
  expect(source).toContain('private async withMergeTreeLock')
  expect(source).toContain('withMergeTreeLock(() => apply({')
})

it('a real curator lock wrapper waits for the merge fence', async () => {
  await tempHome('dsh-rg4-curator-runtime-')
  const ctx = new Context()
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(EvolutionCurator, { enabled: false })
  const curator = ctx.evolutionCurator as unknown as { withMergeTreeLock<T>(body: () => Promise<T>): Promise<T> }
  const io = nodeEvolutionIo()
  const home = evolutionHome()
  const held = await acquireTreeWriteLock({ io, home, waitMs: 0 })
  if (!held.ok) throw new Error('lock failed')
  let ran = false
  const waiting = curator.withMergeTreeLock(async () => { ran = true; return 'curated' })
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(ran).toBe(false)
  await held.lock.release()
  expect(await waiting).toBe('curated')
  expect(ran).toBe(true)
})

it('a curator mutation does not wait for a long scan that holds no fence', async () => {
  await tempHome('dsh-rg4-curator-scan-')
  const ctx = new Context()
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(EvolutionCurator, { enabled: false })
  const curator = ctx.evolutionCurator as unknown as { withMergeTreeLock<T>(body: () => Promise<T>): Promise<T>; skills: { snapshotAll(...args: never[]): Promise<unknown> } }
  const skills = curator.skills
  let openGate: (() => void) | undefined
  const gate = new Promise<void>(resolve => { openGate = resolve })
  const snapshotAll = skills.snapshotAll.bind(skills)
  skills.snapshotAll = async (...args: never[]) => { await gate; return await snapshotAll(...args) }
  const scan = skills.snapshotAll()
  const started = Date.now()
  expect(await curator.withMergeTreeLock(async () => 'curated')).toBe('curated')
  expect(Date.now() - started).toBeLessThan(500)
  openGate?.()
  await scan
})
