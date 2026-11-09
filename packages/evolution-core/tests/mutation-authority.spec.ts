// @tier fast
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { nodeEvolutionIo } from '../src/io.ts'
import { LeaseStore } from '../src/lease-store.ts'
import { MutationAuthority, MutationAuthorityError } from '../src/mutation-authority.ts'
import type { MutationSnapshot, MutationSnapshotPort } from '../src/mutation-unit.ts'

const roots: string[] = []
async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-authority-'))
  roots.push(dir)
  return dir
}
afterEach(async () => { while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true }) })

class Snapshots implements MutationSnapshotPort {
  readonly items = new Map<string, MutationSnapshot>()
  async write(snapshot: MutationSnapshot): Promise<void> { this.items.set(snapshot.unitId, snapshot) }
  async read(unitId: string): Promise<MutationSnapshot | null> { return this.items.get(unitId) ?? null }
  async listPrepared(): Promise<MutationSnapshot[]> { return [...this.items.values()].filter(item => item.state === 'prepared') }
}

const limits = { maxSkillFileBytes: 10000, maxSkillContentChars: 10000 }

describe('MutationAuthority', () => {
  it('requires an active lease before apply and stamps the snapshot', async () => {
    const home = await root()
    const io = nodeEvolutionIo()
    const leases = new LeaseStore({ io, home })
    const authority = new MutationAuthority({ io, home, leases })
    const target = join(home, 'skill', 'SKILL.md')
    const snapshots = new Snapshots()
    const request = {
      name: 'skill',
      roots: [{ name: 'skill', protection: 'write' as const }],
      rootDirs: { skill: join(home, 'skill') },
      ops: [{ kind: 'write' as const, target, content: 'hello', expected: null, skill: 'skill' }],
      origin: 'foreground',
      auditAction: 'write',
      auditSummary: 'test',
      eventAction: 'write',
    }
    const acquired = await leases.acquire('foreground', 'run-1')
    expect(acquired.ok).toBe(true)
    if (!acquired.ok) return
    const result = await authority.apply(request, { owner: 'foreground', runId: 'run-1', lease: acquired.token }, { limits, snapshots })
    expect(result.ok).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('hello')
    expect([...snapshots.items.values()][0]).toMatchObject({ owner: 'foreground', runId: 'run-1', leaseId: acquired.lease.id, state: 'committed' })
    await leases.release(acquired.token)
    await expect(authority.apply(request, { owner: 'foreground', runId: 'run-1', lease: acquired.token }, { limits, snapshots })).rejects.toBeInstanceOf(MutationAuthorityError)
  })

  it('runs a single-file transact under the fence and lease', async () => {
    const home = await root()
    const io = nodeEvolutionIo()
    const leases = new LeaseStore({ io, home })
    const authority = new MutationAuthority({ io, home, leases })
    const path = join(home, 'state.json')
    await writeFile(path, 'before')
    const acquired = await leases.acquire('foreground', 'run-2')
    expect(acquired.ok).toBe(true)
    if (!acquired.ok) return
    await authority.transact(path, current => current === 'before' ? 'after' : current, { owner: 'foreground', runId: 'run-2', lease: acquired.token })
    expect(await readFile(path, 'utf8')).toBe('after')
    await leases.release(acquired.token)
  })

  it('blocks recovery while the run lease is active, then recovers after release', async () => {
    const home = await root()
    const io = nodeEvolutionIo()
    const leases = new LeaseStore({ io, home })
    const authority = new MutationAuthority({ io, home, leases })
    const target = join(home, 'skill', 'SKILL.md')
    await io.writeText(target, 'new')
    const snapshots = new Snapshots()
    snapshots.items.set('u-1', { unitId: 'u-1', state: 'prepared', ops: [{ target, before: 'old', after: 'new', skill: 'skill' }], createdAt: 1, owner: 'foreground', runId: 'run-3', leaseId: 'lease-3' })
    const acquired = await leases.acquire('foreground', 'run-3')
    expect(acquired.ok).toBe(true)
    if (!acquired.ok) return
    const blocked = await authority.recover({ snapshots, limits })
    expect(blocked.blocked).toHaveLength(1)
    expect(await readFile(target, 'utf8')).toBe('new')
    await leases.release(acquired.token)
    const recovered = await authority.recover({ snapshots, limits })
    expect(recovered.recovered[0]?.ok).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('old')
  })
})
