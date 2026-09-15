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

  it('keeps the instance-claim contract for any row that declares it', () => {
    // v43 FLOW2-1: the claim is a module-scope Map (instance-scope.ts), so it can
    // only serialize ROWS of one process. A row that still declares it must name a
    // declared key, prove the claim call in its writer, and SAY in its note that the
    // guarantee is single-process — and the multi-step sweep site (curator-reports)
    // may never be such a row: a Map cannot protect the cross-process shape.
    const claimed = instanceClaimedWriteSites()
    const declared = new Set<string>(Object.values(INSTANCE_KEYS))
    for (const site of claimed) {
      expect(declared.has(site.instance)).toBe(true)
      expect(readFileSync(join(packagesRoot, site.writer), 'utf8')).toContain('claimInstance(')
      expect(site.note.toLowerCase()).toMatch(/in-process|single-process/)
    }
    expect(claimed.map(site => site.id)).not.toContain('curator-reports')
  })

  it('v43 FLOW2-1: curator-reports declares the cross-process lock its sweep takes', () => {
    const site = persistedWriteSite('curator-reports')
    // The declaration names the mechanism the CODE implements (rule N20's
    // subject). `instance-claim` — the former value here — can never be it: a Map
    // cannot exclude a second PROCESS over one home.
    expect(site.serializedBy).toBe('transact')
    expect(site.instance).toBeUndefined()
    expect(readFileSync(join(packagesRoot, site.writer), 'utf8')).toContain(site.marker)
    // The lock is the SWEEP's (a list + delete over a directory), so the note has
    // to name the lock target, the scope it does not cover, and the trigger.
    expect(site.note).toContain('.retention')
    expect(site.note).toMatch(/PROCESS/)
  })

  it('fails loud on an undeclared id instead of reading nothing', () => {
    expect(persistedWriteSite('curator-reports').serializedBy).toBe('transact')
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
