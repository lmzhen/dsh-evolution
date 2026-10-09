import { describe, expect, it } from 'vitest'
import { SkillLibrary } from '../src/skill-store.ts'

// v43 audit (FLOW3-2): the create path's case-variant probe used
// `.catch(() => [])`, so a FAILED listing was read as "no variant exists" and
// the create proceeded — the same input the probe exists to refuse. The guard
// now fails closed, matching the line the file's other enumeration probe draws.
describe('create refuses when the case-variant probe cannot list (FLOW3-2)', () => {
  it('a failing listing refuses the create instead of creating beside a case-variant', async () => {
    const writes: string[] = []
    const io = {
      readText: async () => null,
      writeText: (path: string) => { writes.push(path); return Promise.resolve() },
      remove: async () => {},
      list: () => Promise.reject(Object.assign(new Error('EACCES: injected listing failure'), { code: 'EACCES' })),
      exists: async () => false,
      rename: async () => {},
      copy: async () => {},
    }
    const library = new SkillLibrary(undefined, io)
    const result = await library.create('my-tool', '---\nname: my-tool\ndescription: d.\n---\nBody.\n', 'foreground')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('could not be checked for a case-variant collision')
    expect(result.message).toContain('EACCES: injected listing failure')
    // Nothing was written: the refusal happens before any body lands.
    expect(writes).toEqual([])
  })

  it('an empty listing still creates (the control: refusal is about the failure, not about being empty)', async () => {
    const writes: string[] = []
    const io = {
      readText: async () => null,
      writeText: (path: string) => { writes.push(path); return Promise.resolve() },
      remove: async () => {},
      list: () => Promise.resolve([] as string[]),
      exists: async () => false,
      rename: async () => {},
      copy: async () => {},
    }
    const library = new SkillLibrary(undefined, io)
    const result = await library.create('my-tool', '---\nname: my-tool\ndescription: d.\n---\nBody.\n', 'foreground')
    expect(result.ok).toBe(true)
    expect(writes.length).toBeGreaterThan(0)
  })
})
// O-7 / PLAN S3.2 (audit 1-2): the restore candidate scan swallowed read failures too - a candidate
// whose `.archive-name` or SKILL.md could not be read looked like one with NO marker and NO file,
// and the exact-name shortcut then claimed it (the same collapse the list() path already refuses).
describe('restore refuses to guess when an archived candidate cannot be read', () => {
  it('an unreadable candidate is named as unreadable instead of being chosen by its directory name', async () => {
    const writes: string[] = []
    const io = {
      readText: (path: string) => path.endsWith('.archive-name')
        ? Promise.reject(Object.assign(new Error('EACCES: injected read failure'), { code: 'EACCES' }))
        : Promise.resolve(null),
      writeText: (path: string) => { writes.push(path); return Promise.resolve() },
      remove: async () => {},
      list: (dir: string) => Promise.resolve(dir.includes('.archive') ? ['my-tool'] : []),
      exists: async () => false,
      rename: async () => {},
      copy: async () => {},
    }
    const library = new SkillLibrary(undefined, io)
    const result = await library.restoreFromArchive('my-tool')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('my-tool')
    expect(result.message).toContain('no readable SKILL.md')
    // Nothing was moved or written: the refusal happens before any byte lands in the active tree.
    expect(writes).toEqual([])
  })
})
