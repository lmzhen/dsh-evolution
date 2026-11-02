// @tier ci-only
import { expect, it } from 'vitest'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { ViewSnapshotStore } from '../src/index.ts'

function io(): EvolutionIoLike {
  const files = new Map<string, string>()
  return {
    readText: async path => files.get(path) ?? null,
    writeText: async (path, content) => { files.set(path, content) },
    remove: async path => { files.delete(path) },
    list: async () => [],
    exists: async path => files.has(path),
    rename: async (path, destination) => { const value = files.get(path); if (value !== undefined) { files.delete(path); files.set(destination, value) } },
    copy: async (path, destination) => { const value = files.get(path); if (value !== undefined) files.set(destination, value) },
  }
}

it('freezes legacy sessions and older epochs', async () => {
  const store = new ViewSnapshotStore(io(), 'snapshots.json')
  const snapshot = { sessionId: 's1', viewKey: 'v1', cwd: '/w', viewCatalogDigest: 'c', mapVersion: 'm', configDigest: 'cfg', featureEpoch: 'old', createdAt: 1 }
  await store.put(snapshot)
  expect(await store.isFrozen('s1', 'new')).toBe(true)
  expect(await store.isFrozen('s1', 'old')).toBe(false)
  expect(await store.isFrozen('missing', 'new')).toBe(true)
  expect((await store.get('s1'))?.viewKey).toBe('v1')
  await store.put({ ...snapshot, viewKey: 'v2' })
  expect((await store.get('s1'))?.viewKey).toBe('v1')
  await store.put({ ...snapshot, viewKey: 'v2' }, { overwrite: true })
  expect((await store.get('s1'))?.viewKey).toBe('v2')
})

it('P2-8: concurrent puts for different sessions both survive', async () => {
  const store = new ViewSnapshotStore(io(), 'snapshots.json')
  const base = { viewKey: 'v1', cwd: '/w', viewCatalogDigest: 'c', mapVersion: 'm', configDigest: 'cfg', featureEpoch: 'e', createdAt: 1 }
  await Promise.all([
    store.put({ sessionId: 'a', ...base }),
    store.put({ sessionId: 'b', ...base }),
  ])
  expect(await store.get('a')).toBeDefined()
  expect(await store.get('b')).toBeDefined()
})
