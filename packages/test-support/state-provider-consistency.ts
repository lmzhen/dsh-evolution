/**
 * Cross-provider consistency harness (G7.4, 0.3.22).
 *
 * Runs the SAME observable operation sequence against an
 * `EvolutionStateStorage` provider (json or domain) and asserts both yield the
 * same result. Timestamp fields that legitimately differ between provider
 * claims (createdAt, claimedAt, resolvedAt) are excluded; every other field
 * must match, and status filtering / release rollback must agree.
 */
import { expect } from 'vitest'
import type { CuratorStateRecord, EvolutionStateStorage, PendingRecord } from '@deepseek-ai/dsh-evolution-state-storage'

const pendingOf = (id: string, kind: PendingRecord['kind'] = 'memory'): PendingRecord => ({
  id,
  kind,
  summary: `${kind}:${id}`,
  args: {},
  createdAt: 'now',
  status: 'pending',
})

export async function runStateProviderConsistency(provider: EvolutionStateStorage): Promise<void> {
  // --- review-state round-trip ---
  await provider.saveReviewState('s-consistent', { turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 })
  expect(await provider.loadReviewState('s-consistent')).toEqual({ turnsSinceMemory: 1, turnsSinceSkill: 2, lastTurn: 3 })

  // --- curator-state: missing seed creates; null = keep; overwrite replaces ---
  expect(await provider.loadCuratorState()).toBeNull()
  await provider.transactCuratorState(() => ({ lastRunAt: 10, runCount: 0, lastSummary: 'seed', paused: false }))
  expect((await provider.loadCuratorState())?.runCount).toBe(0)
  await provider.transactCuratorState(() => null)
  expect((await provider.loadCuratorState())?.lastSummary).toBe('seed')
  await provider.transactCuratorState(current => ({ ...(current as CuratorStateRecord), lastSummary: 'updated' }))
  expect((await provider.loadCuratorState())?.lastSummary).toBe('updated')

  // --- claim → resolve (pending → executing → approved) ---
  await provider.savePending(pendingOf('c-live'))
  expect((await provider.listPending('pending')).map(record => record.id)).toContain('c-live')
  const claimed = await provider.claimPending('c-live', 'claim-a')
  expect(claimed?.status).toBe('executing')
  expect(claimed?.claimedBy).toBe('claim-a')
  const resolved = await provider.tryResolvePending('c-live', 'approved')
  expect(resolved.applied).toBe(true)
  expect(resolved.record?.id).toBe('c-live')
  expect(resolved.record?.status).toBe('approved')
  expect((await provider.listPending('approved')).map(record => record.id)).toContain('c-live')
  expect((await provider.listPending('pending')).map(record => record.id)).not.toContain('c-live')

  // --- claim → release rolls executing back to pending (failure path) ---
  await provider.savePending(pendingOf('c-release', 'skill'))
  expect((await provider.claimPending('c-release', 'claim-b'))?.status).toBe('executing')
  await provider.releasePendingClaim('c-release', 'claim-b')
  const released = (await provider.listPending('pending')).find(record => record.id === 'c-release')
  expect(released?.status).toBe('pending')
  expect(released?.claimedBy).toBeUndefined()
  expect(released?.claimedAt).toBeUndefined()

  // --- status filtering is consistent (a pending record is not 'approved') ---
  await provider.savePending(pendingOf('c-filter'))
  expect((await provider.listPending('pending')).map(record => record.id)).toContain('c-filter')
  expect((await provider.listPending('approved')).map(record => record.id)).not.toContain('c-filter')
}
