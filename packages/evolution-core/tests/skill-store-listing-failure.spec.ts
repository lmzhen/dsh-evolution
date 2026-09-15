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
