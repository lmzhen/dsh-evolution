// @tier pre-tag
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { makeV4Home, v3Row } from './support/schema4-home.ts'
import { journalPath } from '../src/domain/commit-journal-store.ts'
import { mergeDoctor, mergeDoctorFact, pairKey, rowIdOf } from '../src/index.ts'
import { readMergeSnapshot } from '../src/domain/merge-snapshot.ts'
import { buildDoctorView } from '../src/surface/merge-view.ts'
import { mergeStatePath } from '../src/state.ts'

const AT = '2026-10-20T00:00:00.000Z'
const pendingRow = (a: string, b: string, runId?: string) => {
  const key = pairKey(a, b)
  return { id: rowIdOf(key), pairKey: key, a, b, version: 0, createdAt: AT, updatedAt: AT, origin: 'agent', state: 'pending', target: a, decision: { shouldMerge: true, mode: 'merge-into-existing', target: a, sources: [b], rationale: 'r' }, attempts: 0, ...(runId === undefined ? {} : { runId }) }
}

it('reports empty, populated and unreadable state without writing', async () => {
  const home = await tempRoot('dsh-merge-doctor-')
  const io = nodeEvolutionIo()
  const empty = await mergeDoctor(io, home)
  expect(empty.map(item => item.key)).toEqual(['state', 'merge-state-v3', 'quarantine', 'tree-lock', 'backup', 'migration', 'staging-index', 'target-claim', 'runs', 'install', 'reconcile', 'consistency', 'models', 'staging', 'staging-path'])
  expect(empty[0]).toMatchObject({ status: 'ok' })
  const v4 = await makeV4Home([pendingRow('alpha-skill', 'beta-skill')])
  const rows = await mergeDoctor(v4.io, v4.home)
  expect(rows[0]?.detail).toContain('pending 1')
})

it('counts a skipped-ttl expired row in the doctor state line', async () => {
  const v4 = await makeV4Home([v3Row({ id: 's1', state: 'skipped', reason: 'agent keep', expiredAt: Date.parse(AT) } as never)])
  const rows = await mergeDoctor(v4.io, v4.home)
  const state = rows.find(item => item.key === 'state')
  expect(state?.detail).toContain('expired 1')
  expect(state?.detail).toContain('skipped 0')
})

it('exposes host-only E-323 to the doctor view and fact', async () => {
  const v4 = await makeV4Home([])
  const snapshot = await readMergeSnapshot({ io: v4.io, home: v4.home, runs: [], approval: false, hostOnly: async () => ({ code: 'E-323', detail: 'agentPresets not mounted' }) })
  const view = buildDoctorView(snapshot)
  expect(view.hostOnly).toEqual({ code: 'E-323', detail: 'agentPresets not mounted' })
  const fact = mergeDoctorFact(view, null)
  expect(fact.status).toBe('fail')
  expect(fact.detail).toContain('E-323')
})

it('does not warn a pending row with an awaiting-approval run', async () => {
  const v4 = await makeV4Home([pendingRow('alpha-skill', 'beta-skill', 'run-1')])
  expect((await mergeDoctor(v4.io, v4.home)).find(item => item.key === 'consistency')?.status).toBe('ok')
})

it('uses mergeModelsRoot only and never reads the engine env fallback', async () => {
  const home = await tempRoot('dsh-merge-doctor-models-')
  const io = nodeEvolutionIo()
  vi.stubEnv('SKILL_MERGE_MODELS_ROOT', 'C:/env-models')
  try {
    const unconfigured = await mergeDoctor(io, home)
    expect(unconfigured.find(item => item.key === 'models')?.detail).toContain('未配置 mergeModelsRoot')
    const configured = await mergeDoctor(io, home, 'C:/models')
    expect(configured.find(item => item.key === 'models')?.detail).toContain('C:/models')
  } finally { vi.unstubAllEnvs() }
})

it('derives a warn from a real journal inconsistency fixture', async () => {
  const v4 = await makeV4Home([v3Row({ id: 'fuse-1', state: 'fuse', runId: 'run-1', target: 'a', decision: { shouldMerge: true, mode: 'merge-into-existing', target: 'a', sources: ['b'], rationale: 'r' } })])
  await mkdir(join(v4.home, 'merge', 'journals'), { recursive: true })
  await writeFile(journalPath(v4.home, 'run-1'), JSON.stringify({ runId: 'run-1', phase: 'prepared', target: 'a', sources: ['b'], updatedAt: 'u' }))
  const consistency = (await mergeDoctor(v4.io, v4.home)).find(item => item.key === 'consistency')
  expect(consistency?.status).toBe('warn')
  expect(consistency?.detail).toContain('fuse-1=')
})
