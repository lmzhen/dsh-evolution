// @tier pre-tag
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'
import { isV3Row } from '../../src/domain/row-v3.ts'
import { loadMergeState, mergeStatePath, upsertRow } from '../../src/state.ts'

const base = { id: 'r', pairKey: 'a|b', a: 'a', b: 'b', version: 0, createdAt: 'c', updatedAt: 'u', origin: 'agent', attempts: 0 }

it('rejects unknown, missing and wrong-shaped rows', () => {
  for (const value of [
    null, 1, 'x', {},
    { ...base, state: 'unknown' },
    { ...base, state: 'pending' },
    { ...base, state: 'approved', target: 'a' },
    { ...base, state: 'fuse', target: 'a', decision: {}, staging: { kind: 'present' } },
    { ...base, state: 'skipped' },
    { ...base, state: 'verify', verifySubState: 'bad' },
    { ...base, state: 'verify', verifySubState: 'candidate', origin: 'other' },
  ]) expect(isV3Row(value)).toBe(false)
})

it('runtime load turns an invalid v3 row into needs-repair and refuses writes', async () => {
  const home = await tempRoot('dsh-rg2-schema-')
  const io = nodeEvolutionIo()
  await mkdir(join(home, 'merge'), { recursive: true })
  const bytes = JSON.stringify({ schemaVersion: 3, rows: [{ ...base, state: 'unknown' }] })
  await writeFile(mergeStatePath(home), bytes)
  const loaded = await loadMergeState(io, home)
  expect(loaded.ok).toBe(false)
  expect(loaded.note).toBe('merge-state-needs-repair')
  await expect(upsertRow(io, home, () => 1, { ...base, state: 'verify', verifySubState: 'candidate', attempts: 0 })).rejects.toThrow('merge-state-needs-repair')
  expect(createHash('sha256').update(await readFile(mergeStatePath(home))).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'))
})

it('accepts the five valid states', () => {
  const decision = { shouldMerge: true, mode: 'merge-into-existing', target: 'a', sources: ['b'], rationale: 'r' }
  expect(isV3Row({ ...base, state: 'verify', verifySubState: 'candidate' })).toBe(true)
  expect(isV3Row({ ...base, state: 'pending', target: 'a', decision })).toBe(true)
  expect(isV3Row({ ...base, state: 'approved', target: 'a', decision })).toBe(true)
  expect(isV3Row({ ...base, state: 'fuse', target: 'a', decision, staging: { kind: 'absent' } })).toBe(true)
  expect(isV3Row({ ...base, state: 'skipped', reason: 'r' })).toBe(true)
})
