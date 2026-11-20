import { describe, expect, it } from 'vitest'
import { HybridMutationLock, TargetLockSet, TargetMutationLock } from '@deepseek-ai/dsh-evolution-core'
import { authorityFrom, nodeEvolutionIo, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import { SkillLibrary, skillNamespaceKey } from '@deepseek-ai/dsh-evolution-core/skills'
import { tempRoot } from '../../test-support/temp-home.ts'

const skill = (name: string, body: string) => `---\nname: ${name}\ndescription: A sufficiently long description for the keyed concurrency test.\n---\n\n${body}\n`

class SlowIo implements EvolutionIoLike {
  active = 0
  max = 0
  private readonly base = nodeEvolutionIo()
  readText(path: string): Promise<string | null> { return this.slow(() => this.base.readText(path)) }
  writeText(path: string, content: string): Promise<void> { return this.slow(() => this.base.writeText(path, content)) }
  remove(path: string): Promise<void> { return this.base.remove(path) }
  list(path: string): Promise<string[]> { return this.base.list(path) }
  exists(path: string): Promise<boolean> { return this.base.exists(path) }
  rename(from: string, to: string): Promise<void> { return this.base.rename(from, to) }
  copy(from: string, to: string): Promise<void> { return this.base.copy(from, to) }
  transact = this.base.transact?.bind(this.base)
  size = this.base.size?.bind(this.base)
  mtime = this.base.mtime?.bind(this.base)
  private async slow<T>(task: () => Promise<T>): Promise<T> {
    this.active += 1
    this.max = Math.max(this.max, this.active)
    try {
      await new Promise(resolve => setTimeout(resolve, 30))
      return await task()
    } finally {
      this.active -= 1
    }
  }
}

async function setup(): Promise<{ lib: SkillLibrary; io: SlowIo; root: string; locks: TargetLockSet }> {
  const home = await tempRoot('dsh-keyed-locks-')
  const root = `${home}/skills`
  const io = new SlowIo()
  const locks = new TargetLockSet(home)
  const keyed = new TargetMutationLock(locks)
  const hybrid = new HybridMutationLock(keyed, { async acquire() { throw new Error('unexpected keyless mutation lock') } })
  const lib = new SkillLibrary(root, io, undefined, undefined, undefined, undefined, authorityFrom({ origin: 'foreground' }), hybrid)
  await lib.create('a', skill('a', 'a body'), 'foreground')
  await lib.create('b', skill('b', 'b body'), 'foreground')
  io.active = 0
  io.max = 0
  return { lib, io, root, locks }
}

describe('keyed SkillLibrary concurrency', () => {
  it('runs updates on different skills concurrently', async () => {
    const { lib, io } = await setup()
    const [a, b] = await Promise.all([
      lib.update('a', skill('a', 'a changed'), 'foreground'),
      lib.update('b', skill('b', 'b changed'), 'foreground'),
    ])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(io.max).toBeGreaterThan(1)
  }, 30_000)

  it('serializes updates on the same skill', async () => {
    const { lib, io } = await setup()
    const [a, b] = await Promise.all([
      lib.update('a', skill('a', 'a first'), 'foreground'),
      lib.update('a', skill('a', 'a second'), 'foreground'),
    ])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(io.max).toBe(1)
  }, 30_000)
  it('blocks a keyed simple write while the skill namespace is held', async () => {
    const { lib, locks } = await setup()
    const lease = await locks.acquireLease([skillNamespaceKey('a')])
    let finished = false
    const pending = lib.update('a', skill('a', 'blocked'), 'foreground').then((result) => {
      finished = true
      return result
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(finished).toBe(false)
    await lease.release()
    const result = await pending
    expect(result.ok).toBe(true)
  }, 30_000)

  it('does not deadlock consolidate under the keyed hybrid lock', async () => {
    const { lib } = await setup()
    const outcome = await Promise.race([
      lib.consolidate('a', ['b'], 'foreground'),
      new Promise<{ ok: false; message: string }>(resolve => setTimeout(() => resolve({ ok: false, message: 'timeout' }), 15_000)),
    ])
    expect(outcome.ok).toBe(true)
  }, 30_000)

})
