import { expect, it } from 'vitest'
import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEAD_LOCK_TAKEOVER_MS, EMPTY_LOCK_TAKEOVER_MS, SkillLibrary, decideTakeover, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

// S1.3 (v37, P2-8): the destructive movers' writer probe must answer with the
// SAME rule the io layer acquires and reclaims under (`decideTakeover`): an
// empty body is a creator inside its 30s takeover window, a bare pid is a valid
// holder, and only a body that names no holder at all is a user `*.lock` file.
function skill(name: string): string {
  return '---\nname: ' + name + '\ndescription: ' + name + ' lock probe.\n---\n\n# ' + name + '\n'
}

async function seed(prefix: string, name: string): Promise<{ root: string; lib: SkillLibrary; io: ReturnType<typeof nodeEvolutionIo> }> {
  const root = await tempRoot(prefix)
  const io = nodeEvolutionIo()
  const lib = new SkillLibrary(root, io)
  const created = await lib.create(name, skill(name), 'foreground')
  expect(created.ok).toBe(true)
  return { root, lib, io }
}

it('S1.3 (P2-8): a FRESH empty-body lock refuses the archive (the takeover rule would not reclaim it either)', async () => {
  const { root, lib, io } = await seed('dsh-evo-writerlock-empty-', 'empty-lock-skill')
  const lock = join(root, 'empty-lock-skill', 'SKILL.md.lock')
  await writeFile(lock, '', 'utf8')
  // The protocol the mover must converge with: a fresh empty body is a writer.
  expect(decideTakeover({ body: '', mtimeMs: Date.now(), alive: () => false })).toBe('none')
  const archived = await lib.archive('empty-lock-skill')
  expect(archived.ok).toBe(false)
  expect(archived.message).toContain('write lock present')
  // Nothing moved: the tree is still in the live root.
  expect(await readFile(join(root, 'empty-lock-skill', 'SKILL.md'), 'utf8')).toContain('# empty-lock-skill')
  expect(await io.exists(join(root, '.archive', 'empty-lock-skill'))).toBe(false)
  await rm(lock, { force: true })
})

it('S1.3 (P2-8): a bare-pid lock naming a LIVE holder refuses the archive', async () => {
  const { root, lib, io } = await seed('dsh-evo-writerlock-barepid-', 'bare-pid-skill')
  const lock = join(root, 'bare-pid-skill', 'SKILL.md.lock')
  await writeFile(lock, String(process.pid), 'utf8')
  const archived = await lib.archive('bare-pid-skill')
  expect(archived.ok).toBe(false)
  expect(archived.message).toContain('write lock present')
  expect(await io.exists(join(root, '.archive', 'bare-pid-skill'))).toBe(false)
  await rm(lock, { force: true })
})

it('S1.3 (P2-8): an empty-body lock past the 30s takeover window no longer blocks the mover', async () => {
  const { root, lib, io } = await seed('dsh-evo-writerlock-staleempty-', 'stale-empty-skill')
  const lock = join(root, 'stale-empty-skill', 'SKILL.md.lock')
  await writeFile(lock, '', 'utf8')
  const old = new Date(Date.now() - EMPTY_LOCK_TAKEOVER_MS - 60_000)
  await utimes(lock, old, old)
  expect(decideTakeover({ body: '', mtimeMs: old.getTime(), alive: () => false })).toBe('empty')
  const archived = await lib.archive('stale-empty-skill')
  expect(archived.ok).toBe(true)
  expect(await io.exists(join(root, '.archive', 'stale-empty-skill'))).toBe(true)
})

it('S1.3 (P2-8): a lock naming a GONE holder past the 1s window is not a writer (takeover branch "dead")', async () => {
  const { root, lib, io } = await seed('dsh-evo-writerlock-dead-', 'gone-holder-skill')
  const lock = join(root, 'gone-holder-skill', 'SKILL.md.lock')
  await writeFile(lock, '999999:deadbeef', 'utf8')
  const old = new Date(Date.now() - DEAD_LOCK_TAKEOVER_MS - 60_000)
  await utimes(lock, old, old)
  expect(decideTakeover({ body: '999999:deadbeef', mtimeMs: old.getTime(), alive: () => false })).toBe('dead')
  const archived = await lib.archive('gone-holder-skill')
  expect(archived.ok).toBe(true)
  expect(await io.exists(join(root, '.archive', 'gone-holder-skill'))).toBe(true)
})

it('S1.3 (P2-8) control: a user support file named *.lock still does NOT block the archive', async () => {
  const { root, lib, io } = await seed('dsh-evo-writerlock-userfile-', 'user-lock-skill')
  await mkdir(join(root, 'user-lock-skill', 'references'), { recursive: true })
  const userFile = join(root, 'user-lock-skill', 'references', 'timer.lock')
  await writeFile(userFile, 'MY TIMER STATE v3', 'utf8')
  const archived = await lib.archive('user-lock-skill')
  expect(archived.ok).toBe(true)
  expect(await io.readText(join(root, '.archive', 'user-lock-skill', 'references', 'timer.lock'))).toBe('MY TIMER STATE v3')
})
