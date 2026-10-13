/**
 * G3b（PLAN-R6 §28.2/28.3）：`unitHead` 一字段两形态 —— 代表片带 {moves, sources}、路标只带 {skill}。
 * 今天字段还不存在 ⇒ 用 `it.fails` 钉住；G3b 落地时翻成 `it`，翻牌即「已实现」的证据。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo, SkillLibrary } from '@deepseek-ai/dsh-evolution-core'

const stamp = String.fromCharCode(10)
const bodyWithExtra = ['---', 'name: h-skill', 'description: h-skill body', '---', '', '## Extra', 'extra content', ''].join(stamp)

it('G3b：代表片必须带 unitHead.moves（全量 manifest）与 unitHead.sources（成员入口）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-unit-head-'))
  try {
    const lib = new SkillLibrary(root, nodeEvolutionIo())
    await lib.create('h-skill', bodyWithExtra)
    const moved = await lib.restructure('h-skill', [{ heading: 'Extra', toFile: 'references/extra.md' }], 'foreground')
    expect(moved.ok, moved.message).toBe(true)
    const versions = await lib.listVersions('h-skill')
    const heads = versions.filter(v => (v as { unitHead?: { moves?: unknown[] } }).unitHead?.moves !== undefined)
    expect(heads.length).toBeGreaterThan(0)
    const head = heads[heads.length - 1] as unknown as { unitHead: { moves: unknown[]; sources?: unknown[] } }
    expect(Array.isArray(head.unitHead.moves)).toBe(true)
    expect(head.unitHead.moves.length).toBeGreaterThan(0)
    expect(Array.isArray(head.unitHead.sources)).toBe(true)
    expect((head.unitHead.sources ?? []).length).toBeGreaterThan(0)
    expect((head.unitHead.sources ?? []).length).toBe(1)
    expect((head.unitHead.sources ?? [])[0]).toEqual({ skill: 'h-skill' })
    // R2: this restructure CREATES references/extra.md, so kind must be created (a blanket 'moved' is red).
    expect((head.unitHead.moves as Array<{ kind: string }>).every(m => m.kind === 'created')).toBe(true)
    // F-G3b-1: the invariant is PER UNIT -- a landing that mints a baseline AND an after must still
    // leave exactly one head, otherwise member resolution counts every shard twice.
    const headsByUnit = new Map<string, number>()
    for (const v of versions) {
      const u = (v as { unitId?: string }).unitId
      if (u === undefined) continue
      if ((v as { unitHead?: unknown }).unitHead !== undefined) headsByUnit.set(u, (headsByUnit.get(u) ?? 0) + 1)
    }
    expect([...headsByUnit.values()].every((count) => count === 1)).toBe(true)
    // R1: exactly ONE entry carries the head, and it is the FIRST entry of the unit.
    const withHead = versions.filter(v => (v as { unitHead?: unknown }).unitHead !== undefined)
    expect(withHead.length).toBe(1)
    const unitId = (withHead[0] as { unitId?: string }).unitId
    const firstOfUnit = versions.filter(v => (v as { unitId?: string }).unitId === unitId)[0]
    expect((firstOfUnit as { v: number }).v).toBe((withHead[0] as { v: number }).v)
    // R3: set-style, not count-style -- every move path exists and no foreign path appears.
    const paths = new Set((head.unitHead.moves as Array<{ path: string }>).map(m => m.path))
    expect([...paths].every(p => p.length > 0)).toBe(true)
    expect(paths.has('references/extra.md')).toBe(true)
    // 两形态互斥：同一 entry 不得同时带 moves 与 skill。
    const both = versions.filter((v) => {
      const h = (v as { unitHead?: { moves?: unknown; skill?: unknown } }).unitHead
      return h !== undefined && h.moves !== undefined && h.skill !== undefined
    })
    expect(both).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
})
