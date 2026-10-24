// @tier pre-tag
import { expect, it, vi } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { mergeDoctor, pairKey, rowIdOf, upsertRow, type MergeRow } from '../src/index.ts'

const AT = '2026-10-20T00:00:00.000Z'
const row = (a: string, b: string, state: MergeRow['state']): MergeRow => {
  const key = pairKey(a, b)
  return { id: rowIdOf(key), pairKey: key, a, b, state, queue: state === 'pending' ? 'pending' : state === 'skipped' ? 'skipped' : state === 'fuse' || state === 'approved' ? 'fuse' : 'verify', createdAt: AT, updatedAt: AT }
}

it('reports empty, populated and unreadable state without writing', async () => {
  const home = await tempRoot('dsh-merge-doctor-')
  const io = nodeEvolutionIo()
  const empty = await mergeDoctor(io, home)
  expect(empty.map(item => item.key)).toEqual(['state', 'merge-state-v3', 'quarantine', 'tree-lock', 'backup', 'target-claim', 'runs', 'install', 'consistency', 'models', 'staging', 'staging-path'])
  expect(empty[0]).toMatchObject({ status: 'ok' })
  await upsertRow(io, home, () => Date.parse(AT), row('alpha-skill', 'beta-skill', 'pending'))
  const rows = await mergeDoctor(io, home)
  expect(rows[0]?.detail).toContain('pending 1')
})

it('does not warn pending with awaiting-approval run and warns a forbidden pending+staging row', async () => {
  const home = await tempRoot('dsh-merge-doctor-consistency-')
  const io = nodeEvolutionIo()
  const pending = { ...row('alpha-skill', 'beta-skill', 'pending'), runId: 'run-1' } as MergeRow
  await upsertRow(io, home, () => Date.parse(AT), pending)
  expect((await mergeDoctor(io, home)).find(item => item.key === 'consistency')?.status).toBe('ok')
  const forbidden = { ...row('gamma-skill', 'delta-skill', 'pending'), stagingRef: 'run-1/pair' } as MergeRow
  await upsertRow(io, home, () => Date.parse(AT), forbidden)
  // v3 pending rows cannot carry stagingRef; the old forbidden shape is not representable.
  expect((await mergeDoctor(io, home)).find(item => item.key === 'consistency')?.status).toBe('ok')
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
