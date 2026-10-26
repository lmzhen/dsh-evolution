// @tier pre-tag
// E2 (FR-EXEC-12 / GAP-CAND-02 / FR-EXEC-11/14 / FR-VAL-03): the decision-time anchors
// travel producer -> assembly -> store, and a changed live tree is refused with a typed
// cause; validation findings land in skipped, manifest files[] is checked on both paths.
import { expect, it } from 'vitest'
import { contentHash, nodeEvolutionIo, revisionFingerprint, revisionSupportDigest, type CommitMergePlan, type RevisionFile } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { makeV4Home, v3Row } from './support/schema4-home.ts'
import {
  commitStagedRun, createStaging, pairKey, recordRound2Outcome, runAuthoring, runNewChildAuthoring, stageKeyOf,
  writeStagedFile, type CommitPort, type ConversationChannelLike, type MergeDecision, type MergeRow, type RevisionRef, type SkillCard,
} from '../src/index.ts'
import { withDecisionRevisions } from '../src/revision.ts'
import { readPairLedgerV4 } from '../src/domain/pair-ledger.ts'

const BODY = (name: string): string => ['---', 'name: ' + name, 'description: A merge fixture skill.', '---', '', '# ' + name, '', 'Body of ' + name + '.', ''].join('\n')

function anchor(name: string, body: string, files: readonly RevisionFile[]): RevisionRef {
  return { kind: 'present', sha256: contentHash(revisionFingerprint(name, body, files)) }
}

const A_FILES: readonly RevisionFile[] = [{ path: 'references/a.md', content: '# a\n' }]
const B_FILES: readonly RevisionFile[] = []

const cards: SkillCard[] = [
  { name: 'alpha-skill', description: 'a', body: BODY('alpha-skill'), files: A_FILES, managed: true },
  { name: 'beta-skill', description: 'b', body: BODY('beta-skill'), files: B_FILES, managed: true },
  { name: 'umbrella', description: 'u', body: BODY('umbrella'), files: [], managed: true },
]
const baseDecision: MergeDecision = { shouldMerge: true, mode: 'merge-into-existing', target: 'umbrella', sources: ['alpha-skill', 'beta-skill'], rationale: 'fixture' }
const decision = withDecisionRevisions(baseDecision, cards, 'alpha-skill', 'beta-skill')

function livePort(options: { readonly mutate?: 'source-support' | 'target-support' } = {}): CommitPort & { plans: CommitMergePlan[] } {
  const plans: CommitMergePlan[] = []
  return {
    plans,
    async readSkill(name) { return cards.find(card => card.name === name)?.body ?? null },
    async readSupportFiles(name) {
      const files = cards.find(card => card.name === name)?.files ?? []
      if (options.mutate === 'source-support' && name === 'alpha-skill') return files.map(file => ({ ...file, content: '# a changed\n' }))
      if (options.mutate === 'target-support' && name === 'umbrella') return [{ path: 'references/new.md', content: '# new\n' }]
      return files
    },
    async commitMerge(plan) { plans.push(plan); return { ok: true, message: 'merged', unitId: 'u-1', archived: plan.sources, mutations: 3 } },
  }
}

async function staged(runId: string): Promise<{ home: string; io: ReturnType<typeof nodeEvolutionIo> }> {
  const home = await tempRoot('dsh-revision-cas-')
  const io = nodeEvolutionIo()
  const created = await createStaging(io, home, {
    runId, target: 'umbrella', mode: 'merge-into-existing',
    sources: cards.map(card => ({ name: card.name, body: card.body, files: card.files ?? [] })),
    promptVersion: 'merge-b/v1', ttlDays: 7, now: () => 1,
  })
  if (!created.ok) throw new Error(created.message)
  await writeStagedFile(io, home, runId, 'SKILL.md', BODY('umbrella'))
  return { home, io }
}

const refs = {
  targetRevision: decision.targetRevisionRef,
  sourceRevisions: decision.sourceRevisions,
  supportDigest: decision.supportDigest,
}

it('the commit plan carries the decision-time anchors, not a fresh cards hash', async () => {
  const { home, io } = await staged('run-1')
  const port = livePort()
  const result = await commitStagedRun(io, home, 'run-1', port, { origin: 'foreground', summary: 'merge', now: () => 2, ...refs })
  expect(result.ok).toBe(true)
  expect(port.plans).toHaveLength(1)
  expect(port.plans[0]?.targetRevision).toEqual(decision.targetRevisionRef)
  expect(port.plans[0]?.sourceRevisions).toEqual(decision.sourceRevisions)
  expect(port.plans[0]?.supportDigest).toBe(decision.supportDigest)
})

it('assembly refuses a target whose support files changed with a typed cause', async () => {
  const { home, io } = await staged('run-2')
  const port = livePort({ mutate: 'target-support' })
  const result = await commitStagedRun(io, home, 'run-2', port, { origin: 'foreground', summary: 'merge', now: () => 2, ...refs })
  expect(result).toMatchObject({ ok: false, code: 'target-changed' })
  expect(port.plans).toHaveLength(0)
})

it('assembly refuses a source whose support files changed with a typed cause', async () => {
  const { home, io } = await staged('run-3')
  const port = livePort({ mutate: 'source-support' })
  const result = await commitStagedRun(io, home, 'run-3', port, { origin: 'foreground', summary: 'merge', now: () => 2, ...refs })
  expect(result).toMatchObject({ ok: false, code: 'source-changed' })
  expect(port.plans).toHaveLength(0)
})

it('assembly refuses a support digest mismatch even when every body is unchanged', async () => {
  const { home, io } = await staged('run-4')
  const port = livePort()
  const result = await commitStagedRun(io, home, 'run-4', port, { origin: 'foreground', summary: 'merge', now: () => 2, targetRevision: refs.targetRevision, sourceRevisions: refs.sourceRevisions, supportDigest: revisionSupportDigest([]) })
  expect(result).toMatchObject({ ok: false, code: 'support-changed' })
  expect(port.plans).toHaveLength(0)
})

it('the scan authoring path checks the child manifest files[]', async () => {
  const home = await tempRoot('dsh-manifest-scan-')
  const io = nodeEvolutionIo()
  const port = livePort()
  const missing = await runAuthoring({
    io, home, runId: 'run-m1', target: 'umbrella', mode: 'merge-into-existing', cards, commitPort: port, now: () => 1, summary: 'merge',
    author: async () => {
      await writeStagedFile(io, home, 'run-m1', 'SKILL.md', BODY('umbrella'))
      return JSON.stringify({ target: 'umbrella', files: ['SKILL.md', 'references/missing.md'] })
    },
  })
  expect(missing).toMatchObject({ ok: false, code: 'merge-manifest-missing' })
  expect(port.plans).toHaveLength(0)
})

it('the scan authoring path accepts a satisfied manifest and commits with the decision anchors', async () => {
  const home = await tempRoot('dsh-manifest-ok-')
  const io = nodeEvolutionIo()
  const port = livePort()
  const ok = await runAuthoring({
    io, home, runId: 'run-m2', target: 'umbrella', mode: 'merge-into-existing', cards, commitPort: port, now: () => 1, summary: 'merge',
    revisions: refs,
    author: async () => {
      await writeStagedFile(io, home, 'run-m2', 'SKILL.md', BODY('umbrella') + '\nSee references/merged.md\n')
      await writeStagedFile(io, home, 'run-m2', 'references/merged.md', '# merged\n')
      return JSON.stringify({ target: 'umbrella', files: ['SKILL.md', 'references/merged.md'] })
    },
  })
  expect(ok.ok).toBe(true)
  expect(port.plans[0]?.targetRevision).toEqual(decision.targetRevisionRef)
  expect(port.plans[0]?.supportDigest).toBe(decision.supportDigest)
})

function channel(writeBody: string | null): ConversationChannelLike {
  return {
    async open() { return { kind: 'ok', childId: 'child-2', turn: { text: 'standby', stopReason: 'completed' } } },
    async continueTurn() {
      return { kind: 'ok', childId: 'child-2', turn: { text: writeBody === null ? '{}' : JSON.stringify({ target: 'umbrella', files: ['SKILL.md'] }), stopReason: 'completed' } }
    },
    async dispose() {},
  }
}

it('a merged new-child outcome carries natural lengths', async () => {
  const home = await tempRoot('dsh-newchild-lengths-')
  const io = nodeEvolutionIo()
  const stageKey = stageKeyOf('run-len', pairKey('alpha-skill', 'beta-skill'))
  const result = await runNewChildAuthoring({
    io, home, runId: 'run-len', cards, channel: {
      ...channel(null),
      async continueTurn() {
        await writeStagedFile(io, home, stageKey, 'SKILL.md', BODY('umbrella'))
        return { kind: 'ok', childId: 'child-2', turn: { text: JSON.stringify({ target: 'umbrella', files: ['SKILL.md'] }), stopReason: 'completed' } }
      },
    }, parent: {}, allow: [], timeoutMs: 1000, commitPort: livePort(), now: () => 1,
  }, { id: 'flen', pairKey: pairKey('alpha-skill', 'beta-skill'), a: 'alpha-skill', b: 'beta-skill', state: 'fuse', queue: 'fuse', decision, createdAt: 'x', updatedAt: 'x' }, decision, new AbortController().signal)
  expect(result.kind).toBe('merged')
  const body = BODY('umbrella')
  const bytes = Buffer.byteLength(body, 'utf8')
  expect(result.kind === 'merged' ? result.lengths : undefined).toEqual({ bodyBytes: bytes, fileBytes: 0, totalBytes: bytes })
})

it('a non-limit blocking finding maps to merge-validation and stays a failed row, not skipped', async () => {
  const home = await tempRoot('dsh-validation-')
  const io = nodeEvolutionIo()
  const noFrontmatter = '# umbrella\n\nno frontmatter here\n'
  const port = livePort()
  const authoring = await runNewChildAuthoring({
    io, home, runId: 'run-v1', cards, channel: {
      ...channel(null),
      async continueTurn() {
        const stageKey = stageKeyOf('run-v1', pairKey('alpha-skill', 'beta-skill'))
        await writeStagedFile(io, home, stageKey, 'SKILL.md', noFrontmatter)
        return { kind: 'ok', childId: 'child-2', turn: { text: JSON.stringify({ target: 'umbrella', files: ['SKILL.md'] }), stopReason: 'completed' } }
      },
    }, parent: {}, allow: [], timeoutMs: 1000, commitPort: port, now: () => 1,
  }, { id: 'f1', pairKey: pairKey('alpha-skill', 'beta-skill'), a: 'alpha-skill', b: 'beta-skill', state: 'fuse', queue: 'fuse', decision, createdAt: 'x', updatedAt: 'x' }, decision, new AbortController().signal)
  expect(authoring).toMatchObject({ kind: 'failed', failure: { stage: 'validate', code: 'merge-validation' } })
  expect(port.plans).toHaveLength(0)
  const v4 = await makeV4Home([v3Row({ id: 'f1', state: 'fuse', target: 'umbrella', decision } as never)])
  const row: MergeRow = { id: 'f1', pairKey: pairKey('alpha-skill', 'beta-skill'), a: 'alpha-skill', b: 'beta-skill', state: 'fuse', queue: 'fuse', decision, createdAt: 'x', updatedAt: 'x' }
  await recordRound2Outcome(v4.io, v4.home, () => 2, row, authoring)
  const persisted = (await readPairLedgerV4(v4.io, v4.home))?.rows[0]
  expect(persisted?.state).toBe('fuse')
  expect(persisted?.state === 'fuse' ? persisted.failure?.code : undefined).toBe('merge-validation')
})

it('removes a report-only commit-failed row without writing skipped', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'f3', state: 'fuse', target: 'umbrella', decision } as never)])
  const row: MergeRow = { id: 'f3', pairKey: pairKey('alpha-skill', 'beta-skill'), a: 'alpha-skill', b: 'beta-skill', state: 'fuse', queue: 'fuse', decision, createdAt: 'x', updatedAt: 'x' }
  const record = await recordRound2Outcome(v4.io, v4.home, () => 2, row, { kind: 'failed', failure: { stage: 'commit', code: 'commit-failed', message: 'boom', retryable: true, retryFrom: 'agent2' } })
  expect(record.pair.outcome).toBe('failed')
  expect((await readPairLedgerV4(v4.io, v4.home))?.rows).toEqual([])
})

it('the new-child commit failure is typed from the decision anchors', async () => {
  const home = await tempRoot('dsh-newchild-typed-')
  const io = nodeEvolutionIo()
  const port = livePort({ mutate: 'source-support' })
  const stageKey = stageKeyOf('run-v2', pairKey('alpha-skill', 'beta-skill'))
  const result = await runNewChildAuthoring({
    io, home, runId: 'run-v2', cards, channel: {
      ...channel(null),
      async continueTurn() {
        await writeStagedFile(io, home, stageKey, 'SKILL.md', BODY('umbrella'))
        return { kind: 'ok', childId: 'child-2', turn: { text: JSON.stringify({ target: 'umbrella', files: ['SKILL.md'] }), stopReason: 'completed' } }
      },
    }, parent: {}, allow: [], timeoutMs: 1000, commitPort: port, now: () => 1,
  }, { id: 'f2', pairKey: pairKey('alpha-skill', 'beta-skill'), a: 'alpha-skill', b: 'beta-skill', state: 'fuse', queue: 'fuse', decision, createdAt: 'x', updatedAt: 'x' }, decision, new AbortController().signal)
  expect(result).toMatchObject({ kind: 'failed', failure: { stage: 'commit', code: 'source-changed', retryable: false, retryFrom: 'none' } })
})
