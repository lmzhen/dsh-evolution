// @tier pre-tag
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { DEFAULT_SKILL_LIMITS, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { SkillLibrary } from '@deepseek-ai/dsh-evolution-core/skills'
import { UnitKernel, fileMutationLock, unitJournalPort, unitSnapshotPort } from '@deepseek-ai/dsh-evolution-core/write'

it('recovers a prepared tree-change snapshot before the first write', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-evo-recover-'))
  const root = join(home, 'skills')
  const io = nodeEvolutionIo()
  try {
    await mkdir(join(root, 'demo'), { recursive: true })
    const target = join(root, 'demo', 'SKILL.md')
    await writeFile(target, 'after')
    await unitSnapshotPort(io, root).write({
      unitId: 'boot-recover-1',
      state: 'prepared',
      createdAt: 1,
      ops: [{ target, before: 'before', after: 'after', skill: 'demo' }],
    })
    const lib = new SkillLibrary(root, io)
    const results = await lib.recoverPreparedUnits()
    expect(results).toHaveLength(1)
    expect(results[0]?.ok).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('before')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('update records a unit that undo restores', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-evo-update-undo-'))
  const root = join(home, 'skills')
  const io = nodeEvolutionIo()
  try {
    const lib = new SkillLibrary(root, io)
    const before = '---\nname: undo-demo\ndescription: undo demo\n---\n\nBefore.\n'
    const after = before.replace('Before.', 'After.')
    expect((await lib.create('undo-demo', before, 'foreground', { managed: true })).ok).toBe(true)
    expect((await lib.update('undo-demo', after, 'foreground')).ok).toBe(true)
    const versions = await lib.listVersions('undo-demo')
    const unitId = versions.map(version => (version as { unitId?: string }).unitId).filter((id): id is string => id !== undefined && id !== '').at(-1)
    expect(unitId).toBeDefined()
    if (unitId === undefined) return
    const unit = new UnitKernel({ nested: true,
      io,
      limits: { maxSkillFileBytes: DEFAULT_SKILL_LIMITS.maxSkillFileBytes, maxSkillContentChars: DEFAULT_SKILL_LIMITS.maxSkillContentChars },
      lock: fileMutationLock(io, root),
      journal: unitJournalPort(io, root),
      snapshots: unitSnapshotPort(io, root),
    })
    const undone = await unit.undo(unitId)
    expect(undone.ok, undone.errors[0]?.message).toBe(true)
    expect(await lib.read('undo-demo')).toBe(before)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('patch records a unit that undo restores', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-evo-patch-undo-'))
  const root = join(home, 'skills')
  const io = nodeEvolutionIo()
  try {
    const lib = new SkillLibrary(root, io)
    const before = '---\nname: patch-undo\ndescription: patch undo\n---\n\nAlpha.\n'
    expect((await lib.create('patch-undo', before, 'foreground', { managed: true })).ok).toBe(true)
    expect((await lib.patch('patch-undo', 'Alpha.', 'Beta.', '', false, 'foreground')).ok).toBe(true)
    const versions = await lib.listVersions('patch-undo')
    const unitId = versions.map(version => (version as { unitId?: string }).unitId).filter((id): id is string => id !== undefined && id !== '').at(-1)
    expect(unitId).toBeDefined()
    if (unitId === undefined) return
    const unit = new UnitKernel({ nested: true,
      io,
      limits: { maxSkillFileBytes: DEFAULT_SKILL_LIMITS.maxSkillFileBytes, maxSkillContentChars: DEFAULT_SKILL_LIMITS.maxSkillContentChars },
      lock: fileMutationLock(io, root),
      journal: unitJournalPort(io, root),
      snapshots: unitSnapshotPort(io, root),
    })
    const undone = await unit.undo(unitId)
    expect(undone.ok, undone.errors[0]?.message).toBe(true)
    expect(await lib.read('patch-undo')).toBe(before)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('create undo removes the body and the managed marker', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-evo-create-undo-'))
  const root = join(home, 'skills')
  const io = nodeEvolutionIo()
  try {
    const lib = new SkillLibrary(root, io)
    const body = '---\nname: create-undo\ndescription: create undo\n---\n\nBody.\n'
    expect((await lib.create('create-undo', body, 'foreground', { managed: true })).ok).toBe(true)
    const versions = await lib.listVersions('create-undo')
    const unitId = versions.map(version => (version as { unitId?: string }).unitId).filter((id): id is string => id !== undefined && id !== '').at(-1)
    expect(unitId).toBeDefined()
    if (unitId === undefined) return
    const unit = new UnitKernel({ nested: true,
      io,
      limits: { maxSkillFileBytes: DEFAULT_SKILL_LIMITS.maxSkillFileBytes, maxSkillContentChars: DEFAULT_SKILL_LIMITS.maxSkillContentChars },
      lock: fileMutationLock(io, root),
      journal: unitJournalPort(io, root),
      snapshots: unitSnapshotPort(io, root),
    })
    const undone = await unit.undo(unitId)
    expect(undone.ok, undone.errors[0]?.message).toBe(true)
    expect(await io.exists(join(root, 'create-undo', 'SKILL.md'))).toBe(false)
    expect(await io.exists(join(root, 'create-undo', '.hermes-managed'))).toBe(false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('runs recovery before the first create writes a new skill', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-evo-recover-create-'))
  const root = join(home, 'skills')
  const io = nodeEvolutionIo()
  try {
    await mkdir(join(root, 'demo'), { recursive: true })
    const target = join(root, 'demo', 'SKILL.md')
    await writeFile(target, 'after')
    await unitSnapshotPort(io, root).write({
      unitId: 'boot-recover-create',
      state: 'prepared',
      createdAt: 1,
      ops: [{ target, before: 'before', after: 'after', skill: 'demo' }],
    })
    const lib = new SkillLibrary(root, io)
    const created = await lib.create('other', '---\nname: other\ndescription: other\n---\n\nBody.\n', 'foreground', { managed: true })
    expect(created.ok, created.message).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('before')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('A3: warns when a prepared unit cannot be recovered', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-evo-recover-drift-'))
  const root = join(home, 'skills')
  const io = nodeEvolutionIo()
  try {
    await mkdir(join(root, 'demo'), { recursive: true })
    const target = join(root, 'demo', 'SKILL.md')
    await writeFile(target, 'third')
    await unitSnapshotPort(io, root).write({
      unitId: 'boot-recover-drift',
      state: 'prepared',
      createdAt: 1,
      ops: [{ target, before: 'before', after: 'after', skill: 'demo' }],
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const lib = new SkillLibrary(root, io)
    await lib.recoverOnBoot()
    const text = warn.mock.calls.flat().join('\n')
    expect(text).toContain('boot-recover-drift')
    expect(text).toContain('recover-drift')
    warn.mockRestore()
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
