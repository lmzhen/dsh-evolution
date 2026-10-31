import { describe, expect, it } from 'vitest'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { DiscoverySessionStore, shouldInstallAwarenessOnResume, shouldProjectPersistedSession } from '../src/index.ts'

class Io implements EvolutionIoLike {
  files = new Map<string, string>()
  async readText(path: string): Promise<string | null> { return this.files.get(path) ?? null }
  async writeText(path: string, content: string): Promise<void> { this.files.set(path, content) }
  async remove(path: string): Promise<void> { this.files.delete(path) }
  async list(): Promise<string[]> { return [...this.files.keys()] }
  async exists(path: string): Promise<boolean> { return this.files.has(path) }
  async rename(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value === undefined) throw new Error('missing'); this.files.set(to, value); this.files.delete(from) }
  async copy(from: string, to: string): Promise<void> { const value = this.files.get(from); if (value === undefined) throw new Error('missing'); this.files.set(to, value) }
}

describe('persisted discovery session metadata', () => {
  it('only projects enabled sessions in the current feature epoch', async () => {
    const store = new DiscoverySessionStore(new Io(), 'sessions.json')
    expect(await shouldProjectPersistedSession(store, 's1', 'epoch-1')).toBe(false)
    await store.put({ sessionId: 's1', discoveryMode: 'on', featureEpoch: 'old' })
    expect(await shouldProjectPersistedSession(store, 's1', 'epoch-1')).toBe(false)
    await store.put({ sessionId: 's1', discoveryMode: 'on', featureEpoch: 'epoch-1' })
    expect(await shouldProjectPersistedSession(store, 's1', 'epoch-1')).toBe(true)
    await store.put({ sessionId: 's1', discoveryMode: 'shadow', featureEpoch: 'epoch-1' })
    expect(await shouldProjectPersistedSession(store, 's1', 'epoch-1')).toBe(false)
    expect(await store.get('missing')).toBeUndefined()
    expect((await store.get('s1'))?.discoveryMode).toBe('shadow')
    await store.put({ sessionId: 's1', discoveryMode: 'on', featureEpoch: 'epoch-1', projectionDigest: 'digest-1' })
    expect((await store.get('s1'))?.projectionDigest).toBe('digest-1')
  })
})


it('preserves the projection digest and mode across a resume-style put and a new process', async () => {
  const io = new Io()
  const first = new DiscoverySessionStore(io, 'sessions.json')
  await first.put({ sessionId: 's1', discoveryMode: 'on', featureEpoch: 'epoch-1', projectionDigest: 'digest-1' })
  await first.put({ sessionId: 's1', discoveryMode: 'on', featureEpoch: 'epoch-1' })
  expect((await first.get('s1'))?.projectionDigest).toBe('digest-1')
  const second = new DiscoverySessionStore(io, 'sessions.json')
  expect((await second.get('s1'))?.projectionDigest).toBe('digest-1')
  expect(await shouldProjectPersistedSession(second, 's1', 'epoch-1')).toBe(true)
})


it('installs awareness on resume only for enabled sessions', () => {
  expect(shouldInstallAwarenessOnResume(undefined, 'e')).toBe(false)
  expect(shouldInstallAwarenessOnResume({ discoveryMode: 'off', featureEpoch: 'e' }, 'e')).toBe(false)
  expect(shouldInstallAwarenessOnResume({ discoveryMode: 'shadow', featureEpoch: 'e' }, 'e')).toBe(true)
  expect(shouldInstallAwarenessOnResume({ discoveryMode: 'on', featureEpoch: 'e' }, 'e')).toBe(true)
  expect(shouldInstallAwarenessOnResume({ discoveryMode: 'on', featureEpoch: 'old' }, 'e')).toBe(false)
})
