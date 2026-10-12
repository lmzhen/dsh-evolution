/**
 * G5: the ledger records WHO wrote (`origin`), and it does so end to end: the parse guard is a type
 * PREDICATE (it keeps the original object), so a field written by `recordMutation` comes back
 * unchanged; and every mutation that goes through `applyTreeChange` threads the write face from the
 * plan it was handed. Both halves are pinned here, so a later refactor cannot silently drop the
 * actor — a field written and not readable back is the silent failure this batch exists to stop.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { loadMutations, nodeEvolutionIo, recordMutation, SkillLibrary } from '@deepseek-ai/dsh-evolution-core'

const stamp = String.fromCharCode(10)
const bodyWithExtra = ['---', 'name: r-skill', 'description: r-skill body', '---', '', '## Extra', 'extra content', ''].join(stamp)

it('账本原样保留 origin（解析守卫不重建字段）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mutation-origin-'))
  try {
    const io = nodeEvolutionIo()
    const at = new Date().toISOString()
    await recordMutation(root, io, { skillName: 's', action: 'update', summary: 'x', at, origin: 'background_review' })
    await recordMutation(root, io, { skillName: 's', action: 'update', summary: 'y', at, origin: 'foreground' })
    const rows = await loadMutations(root, io)
    expect(rows.map(row => row.origin)).toEqual(['background_review', 'foreground'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('store 级：写入面经 plan.origin 落进账本（foreground / background 可区分）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mutation-origin-store-'))
  try {
    const io = nodeEvolutionIo()
    const lib = new SkillLibrary(root, io)
    await lib.create('r-skill', bodyWithExtra)
    const result = await lib.restructure('r-skill', [{ heading: 'Extra', toFile: 'references/extra.md' }], 'background_review')
    expect(result.ok, result.message).toBe(true)
    const rows = (await lib.listMutations()).filter(row => row.skillName === 'r-skill')
    expect(rows.some(row => row.origin === 'background_review')).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
