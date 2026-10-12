/**
 * G2 S4: the family write-lock protocol is retired, so a `*.lock` file is USER CONTENT in every body
 * shape (empty, a bare pid, `pid:token`) — it never blocks a destructive mover, and the bytes ride
 * along into the archive. The one refusal that survives is the fail-closed listing rule: when a
 * support directory cannot be LISTED (EACCES/EIO), the mover refuses rather than assume emptiness.
 */
import { expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SkillLibrary, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

function skill(name: string): string {
  return '---\nname: ' + name + '\ndescription: ' + name + ' lock probe.\n---\n\n# ' + name + '\n'
}

async function seed(prefix: string, name: string, io = nodeEvolutionIo()) {
  const root = await tempRoot(prefix)
  const lib = new SkillLibrary(root, io)
  const created = await lib.create(name, skill(name), 'foreground')
  expect(created.ok).toBe(true)
  return { root, lib, io }
}

it('S4: a *.lock file of ANY body shape is user content and never blocks the archive', async () => {
  const { root, lib, io } = await seed('dsh-evo-lock-userfile-', 'lock-shapes-skill')
  const bodies = { 'SKILL.md.lock': '999999:deadbeef', 'references-empty.lock': '', 'references-pid.lock': String(process.pid) }
  await mkdir(join(root, 'lock-shapes-skill', 'references'), { recursive: true })
  for (const [name, body] of Object.entries(bodies)) {
    const target = name === 'SKILL.md.lock' ? join(root, 'lock-shapes-skill', name) : join(root, 'lock-shapes-skill', 'references', name)
    await writeFile(target, body, 'utf8')
  }
  const archived = await lib.archive('lock-shapes-skill')
  expect(archived.ok).toBe(true)
  // The bytes are the user's: they travel with the tree instead of being swept.
  expect(await io.readText(join(root, '.archive', 'lock-shapes-skill', 'SKILL.md.lock'))).toBe('999999:deadbeef')
  expect(await readFile(join(root, '.archive', 'lock-shapes-skill', 'references', 'references-pid.lock'), 'utf8')).toBe(String(process.pid))
})

it('S4: an unlistable support directory REFUSES the archive (fail-closed, the surviving rule)', async () => {
  const base = nodeEvolutionIo()
  const io = {
    ...base,
    list: async (path: string) => {
      if (path.endsWith('references')) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      return base.list(path)
    },
  }
  const { root, lib } = await seed('dsh-evo-lock-unlistable-', 'unlistable-skill', io)
  await mkdir(join(root, 'unlistable-skill', 'references'), { recursive: true })
  const archived = await lib.archive('unlistable-skill')
  expect(archived.ok).toBe(false)
  expect(archived.message).toContain('could not be listed')
  // Nothing moved: the tree is still in the live root.
  expect(await readFile(join(root, 'unlistable-skill', 'SKILL.md'), 'utf8')).toContain('# unlistable-skill')
})
