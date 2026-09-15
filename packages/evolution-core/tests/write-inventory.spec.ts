import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { INSTANCE_KEYS, instanceClaimedWriteSites, persistedWriteSite, persistedWriteSites } from '@deepseek-ai/dsh-evolution-core'
import { claimInstance, releaseInstance } from '@deepseek-ai/dsh-evolution-core'

const packagesRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

/** The same consistency the architecture gate (rule N20) enforces, as a fast
 * unit gate: the table and the code it describes cannot drift apart silently. */
describe('persisted write inventory (B3 / G4)', () => {
  it('declares a non-empty table whose writer + marker exist in the tree', () => {
    expect(persistedWriteSites().length).toBeGreaterThan(0)
    const failures: string[] = []
    for (const site of persistedWriteSites()) {
      const source = readFileSync(join(packagesRoot, site.writer), 'utf8')
      if (!source.includes(site.marker)) failures.push(`${site.id}: ${site.writer} does not contain ${JSON.stringify(site.marker)}`)
    }
    expect(failures).toEqual([])
  })

  it('gives every site a unique id and a serialization the family implements', () => {
    const ids = persistedWriteSites().map(site => site.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const site of persistedWriteSites()) {
      expect(['transact', 'write-lock', 'instance-claim']).toContain(site.serializedBy)
      expect(site.note.length).toBeGreaterThan(0)
    }
  })

  it('names ONLY real module-scope state keys (the N12 cross-reference)', () => {
    // The state keys are N12 registry keys (`<file> :: <binding>`); a row that
    // names a binding the file does not declare is a stale cross-reference.
    const failures: string[] = []
    for (const site of persistedWriteSites()) {
      for (const key of site.state) {
        const [file, binding] = key.split(' :: ')
        if (!file || !binding) { failures.push(`${site.id}: malformed state key ${key}`); continue }
        if (!new RegExp(`const ${binding}\\s`).test(readFileSync(join(packagesRoot, file), 'utf8'))) {
          failures.push(`${site.id}: ${key} is not a module-scope binding of that file`)
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('resolves an instance-claim row to a real claim site with a declared key', () => {
    const claimed = instanceClaimedWriteSites()
    expect(claimed.length).toBeGreaterThan(0)
    const declared = new Set<string>(Object.values(INSTANCE_KEYS))
    for (const site of claimed) {
      expect(declared.has(site.instance)).toBe(true)
      expect(readFileSync(join(packagesRoot, site.writer), 'utf8')).toContain('claimInstance(')
    }
    expect(claimed.map(site => site.instance)).toContain(INSTANCE_KEYS.curator)
  })

  it('fails loud on an undeclared id instead of reading nothing', () => {
    expect(persistedWriteSite('curator-reports').serializedBy).toBe('instance-claim')
    expect(() => persistedWriteSite('no-such-site')).toThrow(/no persisted write site/)
  })

  it('the claim the inventory declares is the one instance-scope.ts grants', () => {
    // End-to-end shape of a row: the declared key, claimed once, refused twice.
    const home = '/home/inventory'
    expect(claimInstance(home, INSTANCE_KEYS.curator, 'a').granted).toBe(true)
    expect(claimInstance(home, INSTANCE_KEYS.curator, 'b').granted).toBe(false)
    releaseInstance(home, INSTANCE_KEYS.curator, 'a')
  })
})
