// @tier pre-tag
// E2 (FR-LIFE-14 / NFR-06 / GAP-LIFE-01): reads derive pending expiry without writing,
// reconcile is the one writer that persists it, and an expired stage is never reused or
// re-presented — the index, the read face and the resume path agree.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { makeV4Home, v3Row } from './support/schema4-home.ts'
import { readPairLedgerV4 } from '../src/domain/pair-ledger.ts'
import { recordPair } from '../src/domain/pair-index-store.ts'
import { readMergeSnapshot } from '../src/domain/merge-snapshot.ts'
import { liveRowFactsOf } from '../src/domain/live-facts.ts'
import { reconcileMergeState } from '../src/domain/reconcile.ts'
import { createStageTree, readStageEntry, reserveStage, writeStageIndex } from '../src/domain/stage-aggregate.ts'
import { stageKeyOf } from '../src/staging.ts'
import { runNewChildAuthoring, pairKey, type ConversationChannelLike, type MergeDecision, type MergeRow, type SkillCard } from '../src/index.ts'
import { withDecisionRevisions } from '../src/revision.ts'
import { mergeStatePath } from '../src/state.ts'
import { writeStagedFile as writeStaged } from '../src/index.ts'

const BODY = (name: string): string => ['---', 'name: ' + name, 'description: A merge fixture skill.', '---', '', '# ' + name, ''].join('\n')
const card = (name: string, body = BODY(name)): SkillCard => ({ name, description: name, body, managed: true })

const oldCards = [card('a'), card('b'), card('c')]
const liveCards = [card('a', BODY('a') + 'changed\n'), card('b'), card('c')]
const base: MergeDecision = { shouldMerge: true, mode: 'merge-into-existing', target: 'c', sources: ['a', 'b'], rationale: 'fixture' }
const decision = withDecisionRevisions(base, oldCards, 'a', 'b')

it('snapshot derives a stale pending row from the live library and writes nothing', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'p1', state: 'pending', target: 'c', decision } as never)])
  const before = await readFile(mergeStatePath(v4.home), 'utf8')
  const snapshot = await readMergeSnapshot({ io: v4.io, home: v4.home, runs: [], approval: true, now: () => 2, live: async () => liveRowFactsOf(liveCards) })
  expect(snapshot.rows[0]).toMatchObject({ expired: true, expiredKind: 'source-changed' })
  expect(await readFile(mergeStatePath(v4.home), 'utf8')).toBe(before)
  expect((await readPairLedgerV4(v4.io, v4.home))?.rows[0]?.state).toBe('pending')
})

it('a completed pair-index entry still active in the ledger is reported as a degraded conflict', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'p1', state: 'pending', target: 'c', decision } as never)])
  await recordPair(v4.io, v4.home, { pairKey: pairKey('a', 'b'), runId: 'r1', result: 'merged' })
  const snapshot = await readMergeSnapshot({ io: v4.io, home: v4.home, runs: [], approval: true, now: () => 2, live: async () => liveRowFactsOf([card('a'), card('b'), card('c')]) })
  expect(snapshot.degraded).toBe(true)
  expect(snapshot.notes.some(note => note.startsWith('ledger-conflict:'))).toBe(true)
})

it('verify and fuse rows whose source disappeared read expired without a write', async () => {
  const verify = await makeV4Home([v3Row({ id: 'v1', state: 'verify', verifySubState: 'candidate' } as never)])
  const verifySnapshot = await readMergeSnapshot({ io: verify.io, home: verify.home, runs: [], approval: true, now: () => 2, live: async () => liveRowFactsOf([card('a')]) })
  expect(verifySnapshot.rows[0]).toMatchObject({ expired: true, expiredKind: 'source-gone' })
  const fuse = await makeV4Home([v3Row({ id: 'f1', state: 'fuse', target: 'c', decision } as never)])
  const fuseSnapshot = await readMergeSnapshot({ io: fuse.io, home: fuse.home, runs: [], approval: true, now: () => 2, live: async () => liveRowFactsOf([card('c')]) })
  expect(fuseSnapshot.rows[0]).toMatchObject({ expired: true, expiredKind: 'source-gone' })
})

it('a create-umbrella target taken after the decision reads as target-taken', async () => {
  const umbrellaDecision: MergeDecision = { shouldMerge: true, mode: 'create-umbrella', target: 'new-umbrella', sources: ['a', 'b'], rationale: 'fixture', targetRevisionRef: { kind: 'absent' } }
  const v4 = await makeV4Home([v3Row({ id: 'p2', state: 'pending', target: 'new-umbrella', decision: umbrellaDecision } as never)])
  const snapshot = await readMergeSnapshot({ io: v4.io, home: v4.home, runs: [], approval: true, now: () => 2, live: async () => liveRowFactsOf([card('a'), card('b'), card('new-umbrella')]) })
  expect(snapshot.rows[0]).toMatchObject({ expired: true, expiredKind: 'target-taken' })
})

it('reconcile persists the derivation once; read and index agree afterwards', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'p1', state: 'pending', target: 'c', decision } as never)])
  const first = await reconcileMergeState({ io: v4.io, home: v4.home, now: () => 2, ttlDays: 0, live: liveRowFactsOf(liveCards) })
  expect(first.actions).toMatchObject([{ kind: 'pending-expired', rowId: 'p1', code: 'source-changed' }])
  expect((await readPairLedgerV4(v4.io, v4.home))?.rows[0]).toMatchObject({ state: 'pending', expired: 'source-changed' })
  const second = await reconcileMergeState({ io: v4.io, home: v4.home, now: () => 3, ttlDays: 0, live: liveRowFactsOf(liveCards) })
  expect(second.actions).toEqual([])
  const snapshot = await readMergeSnapshot({ io: v4.io, home: v4.home, runs: [], approval: true, now: () => 4 })
  expect(snapshot.rows[0]).toMatchObject({ expired: true, expiredKind: 'source-changed' })
})

it('reconcile never presents an expired stage and persists the expired index state', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'r1', state: 'approved', target: 'c', decision: base } as never)])
  const ref = stageKeyOf('run-x', 'c\u0000a')
  await createStageTree(v4.io, v4.home, { runId: ref, target: 'c', sources: [{ name: 'a', body: BODY('a'), files: [] }], promptVersion: 'v', ttlDays: 7, now: () => 1 })
  await reserveStage(v4.io, v4.home, { version: 1, rowId: 'r1', pairKey: 'c\u0000a', ref, state: 'reserved', createdAt: 1, expiresAt: 1_000, updatedAt: 1 })
  const report = await reconcileMergeState({ io: v4.io, home: v4.home, now: () => 5_000, ttlDays: 0 })
  expect(report.actions).toMatchObject([{ kind: 'approved-fused', rowId: 'r1', code: 'stage-lost' }])
  expect((await readStageEntry(v4.io, v4.home, 'r1'))?.state).toBe('expired')
  const snapshot = await readMergeSnapshot({ io: v4.io, home: v4.home, runs: [], approval: true, now: () => 5_000 })
  expect(snapshot.rows[0]?.stage?.state).toBe('expired')
  expect(snapshot.rows[0]?.row.state).toBe('fuse')
})

it('an expired stage tree is never reused by the resume/approve author', async () => {
  const home = await tempRoot('dsh-stage-expiry-')
  const io = nodeEvolutionIo()
  const cards = [card('a'), card('b')]
  const decision: MergeDecision = { shouldMerge: true, mode: 'create-umbrella', target: 'umbrella', sources: ['a', 'b'], rationale: 'fixture' }
  const row: MergeRow = { id: 'f1', pairKey: pairKey('a', 'b'), a: 'a', b: 'b', state: 'fuse', queue: 'fuse', decision, createdAt: 'x', updatedAt: 'x' }
  const ref = stageKeyOf('run-x', pairKey('a', 'b'))
  await createStageTree(io, home, { runId: ref, target: 'umbrella', mode: 'create-umbrella', sources: [{ name: 'a', body: BODY('a'), files: [] }, { name: 'b', body: BODY('b'), files: [] }], promptVersion: 'v', ttlDays: 7, now: () => 1 })
  await writeStaged(io, home, ref, 'SKILL.md', BODY('umbrella') + 'stale\n')
  await writeStageIndex(io, home, { rowId: 'f1', pairKey: pairKey('a', 'b'), ref, expiresAt: 1_000, createdAt: 1, state: 'present' })
  const channel: ConversationChannelLike = {
    async open() { return { kind: 'ok', childId: 'child-2', turn: { text: 'standby', stopReason: 'completed' } } },
    async continueTurn() { return { kind: 'ok', childId: 'child-2', turn: { text: '{}', stopReason: 'completed' } } },
    async dispose() {},
  }
  const bound: string[] = []
  const result = await runNewChildAuthoring({
    io, home, runId: 'run-x', cards, channel, parent: {}, allow: [], timeoutMs: 1000,
    commitPort: { async readSkill() { return null } }, now: () => 5_000,
    onChild: context => bound.push(context.childId),
  }, row, decision, new AbortController().signal)
  expect(bound).toEqual(['child-2'])
  expect(result).toMatchObject({ kind: 'failed', failure: { code: 'staging-missing' } })
  expect(await readStageEntry(io, home, 'f1')).toBeNull()
  expect(await io.exists(join(home, 'merge', 'runs', ref, 'merged', 'umbrella', 'SKILL.md'))).toBe(false)
})
