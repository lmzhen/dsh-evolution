import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PendingStore } from '../src/pending-store.ts'

describe('PendingStore', () => {
  it('stages, lists, resolves, and removes records', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-'))
    const env = { ...process.env, DSH_HOME: home }
    const store = new PendingStore(env)
    const record = await store.stage('memory', 'add memory entry', { action: 'add', target: 'memory', facts: 'x' })
    expect(record.status).toBe('pending')
    expect(store.list()).toHaveLength(1)
    expect(await store.resolve(record.id, 'approved')).not.toBeNull()
    expect(store.list('approved')).toHaveLength(1)
    await store.remove(record.id)
    expect(store.list('approved')).toHaveLength(0)
    await rm(home, { recursive: true, force: true })
  })

  it('persists across store instances', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-'))
    const env = { ...process.env, DSH_HOME: home }
    const first = new PendingStore(env)
    await first.stage('skill', 'create skill', { action: 'create', name: 'demo' })
    const second = new PendingStore(env)
    expect(second.list()).toHaveLength(1)
    await rm(home, { recursive: true, force: true })
  })
})
