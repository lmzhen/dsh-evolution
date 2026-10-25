// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import type { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { createMergeRuntime, loadMergeState, pairKey, rowIdOf, stageKeyOf, writeStagedFile, type MergeRuntimeDeps, type MergeRow, type SkillCard } from '../../src/index.ts'
import { seedRow } from '../support/seed-row.ts'
import { supportDigestOf, targetRevisionRefOf } from '../../src/revision.ts'

const BODY = (name: string) => ['---', 'name: ' + name, 'description: fixture', '---', '', '# ' + name, ''].join(String.fromCharCode(10))
const baseCards = (): SkillCard[] => [{ name: 'alpha-skill', description: 'a', body: BODY('alpha-skill'), managed: true }, { name: 'beta-skill', description: 'b', body: BODY('beta-skill'), managed: true }, { name: 'umbrella', description: 'u', body: BODY('umbrella'), managed: true }]

async function scenario(decision: MergeRow['decision'], mutateCards?: (cards: SkillCard[]) => void): Promise<{ result: Awaited<ReturnType<ReturnType<typeof createMergeRuntime>['execute']>>; rows: readonly MergeRow[]; prepared: number; receiptExists: boolean; home: string }> {
  const home = await tempRoot('dsh-rg3b-target-')
  const io = nodeEvolutionIo()
  const key = pairKey('alpha-skill', 'beta-skill')
  const row: MergeRow = { id: rowIdOf(key), pairKey: key, a: 'alpha-skill', b: 'beta-skill', state: 'pending', queue: 'pending', decision, runId: 'parent-run', createdAt: 'x', updatedAt: 'x' }
  await seedRow(io, home, row)
  const cards = baseCards()
  let prepared = 0
  const skills = { async list() { return cards }, async read(name: string) { return cards.find(card => card.name === name)?.body ?? null }, async commitMerge(plan: { sources: string[] }) { return { ok: true, message: 'merged', unitId: 'u-1', archived: plan.sources, mutations: 3 } } } as unknown as SkillLibrary
  const registry: MergeRuntimeDeps['registry'] = { async begin() { return { id: 'run-1', signal: new AbortController().signal, startedAt: 1 } }, async stage() {}, async settle() {} }
  const channel = { async open() { return { kind: 'ok' as const, childId: 'child-2', turn: { text: 'standby', stopReason: 'completed' } } }, async continueTurn() { const target = decision?.target ?? 'umbrella'; await writeStagedFile(io, home, stageKeyOf('run-1', key), 'SKILL.md', BODY(target)); return { kind: 'ok' as const, childId: 'child-2', turn: { text: 'written', stopReason: 'completed' } } }, async dispose() {} }
  const deps: MergeRuntimeDeps = { io, home, registry, skills, now: () => 200, params: { mergeApproval: true, mergeSkippedTtlDays: 0, mergeRunTimeoutMinutes: 0, mergePairTimeoutMinutes: 15 }, platformWrite: false, channel, parent: {}, allow: [], timeoutMinutes: 0,
    unit: { async prepare() { prepared += 1; return { ok: true as const, prepared: { unitId: 'u-1', planDigest: 'd' } } }, async commit() { return { ok: true as const, evidence: { unitId: 'u-1', runId: 'run-1', planDigest: 'd', state: 'complete' as const, target: { before: null, after: BODY(decision?.target ?? 'umbrella'), supportDigest: '', created: false }, sources: [], mutations: 0, at: 1 } } }, async verify() { return null }, async rollback() { return { ok: false as const, code: 'unit-committed' as const, message: 'no' } }, async cancel() { return { ok: false, phase: 'none' as const } } } as never,
    cards: async () => { mutateCards?.(cards); return cards }, screeningForRun: async () => [] }
  const result = await createMergeRuntime(deps).execute({ verb: 'approve', id: row.id })
  return { result, rows: (await loadMergeState(io, home)).state.rows, prepared, receiptExists: await io.exists(home + '/merge/receipts/run-1/commit.json'), home }
}

it('target create passes when expected absent and target absent', async () => {
  const result = await scenario({ shouldMerge: true, mode: 'create-umbrella', target: 'new-umbrella', sources: ['alpha-skill'], rationale: 'r', targetRevisionRef: { kind: 'absent' } })
  expect(result.result.ok, result.result.text).toBe(true)
})

it('target absent while expected present is target-taken and zero writes', async () => {
  const cards = baseCards()
  const expected = targetRevisionRefOf(cards, 'umbrella')
  const result = await scenario({ shouldMerge: true, mode: 'merge-into-existing', target: 'umbrella', sources: ['alpha-skill'], rationale: 'r', targetRevisionRef: expected }, list => { const index = list.findIndex(card => card.name === 'umbrella'); if (index >= 0) list.splice(index, 1) })
  expect(result.result.ok).toBe(false)
  expect(result.result.text).toContain('target-taken')
  expect(result.prepared).toBe(0)
  expect(result.rows[0]?.state).not.toBe('fuse')
})

it('target occupied while expected absent is target-taken and zero writes', async () => {
  const result = await scenario({ shouldMerge: true, mode: 'create-umbrella', target: 'new-umbrella', sources: ['alpha-skill'], rationale: 'r', targetRevisionRef: { kind: 'absent' } }, list => { list.push({ name: 'new-umbrella', description: 'u', body: BODY('new-umbrella'), managed: true } as SkillCard) })
  expect(result.result.ok).toBe(false)
  expect(result.result.text).toContain('target-taken')
  expect(result.prepared).toBe(0)
})

it('approve after support change is source-changed and zero writes', async () => {
  const cards = baseCards()
  const digest = supportDigestOf(cards, ['umbrella', 'alpha-skill', 'beta-skill'])
  const result = await scenario({ shouldMerge: true, mode: 'merge-into-existing', target: 'umbrella', sources: ['alpha-skill'], rationale: 'r', supportDigest: digest }, list => { const target = list.find(card => card.name === 'umbrella'); if (target !== undefined) target.files = [{ path: 'references/a.md', content: 'changed' }] })
  expect(result.result.ok).toBe(false)
  expect(result.result.text).toContain('source-changed')
  expect(result.prepared).toBe(0)
})
