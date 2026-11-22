// @tier fast
import { describe, expect, it, vi } from 'vitest'
import { fetchMergePendingCount } from '../src/merge-count.ts'

const answer = (body: unknown, ok = true): Response => ({ ok, json: async () => body } as Response)

describe('fetchMergePendingCount', () => {
  it('reads active.pending from the merge wire view', async () => {
    const fetchImpl = vi.fn(async () => answer({ wireVersion: 1, counts: { active: { pending: 3 } } }))
    await expect(fetchMergePendingCount(fetchImpl as unknown as typeof fetch)).resolves.toBe(3)
  })

  it('refuses a different wire version and a malformed body', async () => {
    await expect(fetchMergePendingCount((async () => answer({ wireVersion: 2, counts: { active: { pending: 9 } } })) as unknown as typeof fetch)).resolves.toBe(0)
    await expect(fetchMergePendingCount((async () => answer({ wireVersion: 1, counts: {} })) as unknown as typeof fetch)).resolves.toBe(0)
    await expect(fetchMergePendingCount((async () => answer({}, false)) as unknown as typeof fetch)).resolves.toBe(0)
  })
})
