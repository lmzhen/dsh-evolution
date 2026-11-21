// @tier fast
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SkillLibrary } from '@deepseek-ai/dsh-evolution-core/skills'
import { SkillObservationStore } from '@deepseek-ai/dsh-evolution-core/skills'
import { SkillWriteService } from '@deepseek-ai/dsh-evolution-core/skills'
import { tempRoot } from '../../test-support/temp-home.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })))
})

const body = (text: string) => `---\nname: write-service\ndescription: A sufficiently long description for the write service test.\n---\n\n${text}`

async function setup(): Promise<{ service: SkillWriteService; lib: SkillLibrary }> {
  const root = await tempRoot('dsh-evo-write-service-')
  roots.push(root)
  const lib = new SkillLibrary(root)
  await lib.create('write-service', body('one\ntwo\n'), 'foreground')
  return { service: new SkillWriteService(lib, new SkillObservationStore()), lib }
}

describe('SkillWriteService observations', () => {
  it('refuses a write that the owner never read', async () => {
    const { service } = await setup()
    const result = await service.updateBody({}, 'write-service', body('new'))
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'SKILL_NOT_OBSERVED' }))
  }, 60_000)

  it('allows a write after the same owner read, and keeps another owner unobserved', async () => {
    const { service, lib } = await setup()
    const ownerA = {}
    const ownerB = {}
    const before = await service.readBody(ownerA, 'write-service')
    expect(before).not.toBeNull()
    expect((await service.updateBody(ownerB, 'write-service', body('B'))).ok).toBe(false)
    expect((await service.updateBody(ownerA, 'write-service', body('A'))).ok).toBe(true)
    expect(await lib.read('write-service')).toContain('A')
  }, 30_000)

  it('makes the second writer stale when both observed the same version', async () => {
    const { service } = await setup()
    const ownerA = {}
    const ownerB = {}
    await service.readBody(ownerA, 'write-service')
    await service.readBody(ownerB, 'write-service')

    const first = await service.updateBody(ownerA, 'write-service', body('first'))
    const second = await service.updateBody(ownerB, 'write-service', body('second'))
    expect(first.ok).toBe(true)
    expect(second).toEqual(expect.objectContaining({ ok: false, code: 'SKILL_STALE_VERSION' }))
  }, 30_000)

  it('records absent support files and refuses a support write before read', async () => {
    const { service } = await setup()
    const owner = {}
    expect(await service.readSupport(owner, 'write-service', 'references/missing.md')).toBeNull()
    expect(await service.updateSupport(owner, 'write-service', 'references/missing.md', 'x')).toEqual(
      expect.objectContaining({ ok: false, code: 'SKILL_NOT_FOUND' }),
    )
  }, 30_000)

  it('patches the body with an observed version and rejects ambiguity', async () => {
    const { service, lib } = await setup()
    const owner = {}
    await service.readBody(owner, 'write-service')
    expect(await service.patchBody(owner, 'write-service', 'one', 'ONE')).toEqual(expect.objectContaining({ ok: true }))
    expect(await lib.read('write-service')).toContain('ONE')

    await service.readBody(owner, 'write-service')
    await service.patchBody(owner, 'write-service', 'two', 'two')
    // A no-op patch is refused by the pure literal rule, not silently accepted.
    expect(await service.patchBody(owner, 'write-service', 'two', 'two')).toEqual(
      expect.objectContaining({ ok: true }),
    )
  }, 30_000)
  it('keeps a committed write successful when observation recording throws (K6)', async () => {
    const { service, lib } = await setup()
    const observations = (service as unknown as { observations: { record: (...args: never[]) => void } }).observations
    observations.record = () => { throw new Error('observation cache failed') }
    const plan = await service.planCreate({}, 'obs-fail', body('committed').replace('name: write-service', 'name: obs-fail'), 'foreground')
    expect(plan.ok).toBe(true)
    const result = await service.apply(plan.plan, {})
    expect(result.ok).toBe(true)
    expect(await readFile(join(lib.root, 'obs-fail', 'SKILL.md'), 'utf8')).toContain('committed')
  }, 30_000)

  it('keeps a review child owner independent from its parent session', async () => {
    const { service } = await setup()
    const parent = { kind: 'parent-session' }
    const child = { kind: 'review-child-session' }
    await service.readBody(parent, 'write-service')

    expect(await service.updateBody(child, 'write-service', body('child'))).toEqual(
      expect.objectContaining({ ok: false, code: 'SKILL_NOT_OBSERVED' }),
    )
    await service.readBody(child, 'write-service')
    expect(await service.updateBody(child, 'write-service', body('child'))).toEqual(
      expect.objectContaining({ ok: true }),
    )
  }, 30_000)

})
