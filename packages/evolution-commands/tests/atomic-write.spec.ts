import { describe, expect, it } from 'vitest'
import * as Commands from '../src/index.ts'
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Real fs operations, narrowed to the signatures atomicWriteFiles expects so the
// object literal satisfies `FsOps` structurally without node:fs overload friction.
const baseFs = {
  writeFileSync: (path: string, data: string | Uint8Array) => { writeFileSync(path, data) },
  existsSync: (path: string) => existsSync(path),
  copyFileSync: (from: string, to: string) => { copyFileSync(from, to) },
  rmSync: (path: string, options?: { force?: boolean; recursive?: boolean }) => { rmSync(path, options) },
}

describe('evolution-commands atomicWriteFiles (F-211)', () => {
  it('restores the previous target from .bak when the post-remove rename also fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evo-commands-atomic-'))
    try {
      writeFileSync(join(dir, 'f'), 'OLD', 'utf8')
      // rename ALWAYS fails (a persistent EPERM): the first rename fails, the
      // code removes the target, and the retry also fails — exactly the F-211
      // window where the target would otherwise be left missing.
      const fsOps = { ...baseFs, renameSync: () => { throw new Error('EPERM: rename failed') } }
      expect(() => { Commands.atomicWriteFiles(dir, [{ name: 'f', content: 'NEW' }], fsOps) }).toThrow()
      // The .bak was created from 'OLD' during the backup phase and restored
      // after the failed commit — the target is NOT left missing.
      expect(readFileSync(join(dir, 'f'), 'utf8')).toBe('OLD')
      expect(existsSync(join(dir, 'f.bak'))).toBe(true)
      // The staged temp is cleaned up.
      expect(existsSync(join(dir, 'f.tmp'))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('V5-17: a mid-commit failure discloses which files already landed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evo-commands-atomic-partial-'))
    try {
      writeFileSync(join(dir, 'a'), 'OLD-A', 'utf8')
      writeFileSync(join(dir, 'b'), 'OLD-B', 'utf8')
      // First file commits, second fails: the caller must learn that 'a'
      // already landed (a partial install is not "nothing happened").
      let calls = 0
      const fsOps = {
        ...baseFs,
        renameSync: (from: string, to: string) => {
          calls += 1
          // Both of b's rename attempts (first and the remove-then-rename
          // retry) must fail for the partial-commit window to surface.
          if (calls >= 2) throw new Error('EPERM: rename failed')
          renameSync(from, to)
        },
      }
      let message = ''
      try {
        Commands.atomicWriteFiles(dir, [{ name: 'a', content: 'NEW-A' }, { name: 'b', content: 'NEW-B' }], fsOps)
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect(message).toContain('already committed: a')
      expect(readFileSync(join(dir, 'a'), 'utf8')).toBe('NEW-A')
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('renames into place after a single refusal: remove-then-rename recovers (E-40 contract)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evo-commands-atomic-ok-'))
    try {
      writeFileSync(join(dir, 'f'), 'OLD', 'utf8')
      // First rename fails (dest "occupied"), the code removes it then renames —
      // a real rename must succeed this time (the single-failure path).
      let first = true
      const fsOps = {
        ...baseFs,
        renameSync: (from: string, to: string) => {
          if (first) { first = false; throw new Error('EPERM: rename failed') }
          renameSync(from, to)
        },
      }
      Commands.atomicWriteFiles(dir, [{ name: 'f', content: 'NEW' }], fsOps)
      expect(readFileSync(join(dir, 'f'), 'utf8')).toBe('NEW')
      expect(existsSync(join(dir, 'f.bak'))).toBe(true)
      expect(existsSync(join(dir, 'f.tmp'))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('V4-17: a successful commit refreshes .bak so it tracks the latest generation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evo-commands-atomic-bak-'))
    try {
      // First install: no pre-existing file, so the backup phase creates nothing
      // and the post-commit refresh seeds .bak with the first generation.
      Commands.atomicWriteFiles(dir, [{ name: 'f', content: 'GEN1' }])
      expect(readFileSync(join(dir, 'f'), 'utf8')).toBe('GEN1')
      expect(existsSync(join(dir, 'f.bak'))).toBe(true)
      expect(readFileSync(join(dir, 'f.bak'), 'utf8')).toBe('GEN1')
      // A second successful commit must refresh .bak to GEN2 — a once-created
      // .bak would otherwise pin the very first generation forever.
      Commands.atomicWriteFiles(dir, [{ name: 'f', content: 'GEN2' }])
      expect(readFileSync(join(dir, 'f.bak'), 'utf8')).toBe('GEN2')
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('V4-17: a failed commit restores from the refreshed .bak (last good generation)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evo-commands-atomic-rec-'))
    try {
      // Land two good generations so .bak is the latest (GEN2).
      Commands.atomicWriteFiles(dir, [{ name: 'f', content: 'GEN1' }])
      Commands.atomicWriteFiles(dir, [{ name: 'f', content: 'GEN2' }])
      // A persistently-failing rename forces the F-211 post-remove window; the
      // refreshed .bak must restore GEN2 — not a several-generations-old GEN1.
      const fsOps = { ...baseFs, renameSync: () => { throw new Error('EPERM: rename failed') } }
      let thrown: unknown
      try {
        Commands.atomicWriteFiles(dir, [{ name: 'f', content: 'GEN3' }], fsOps)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(Error)
      expect((thrown as Error).message).toContain('restored from the last good generation')
      expect(readFileSync(join(dir, 'f'), 'utf8')).toBe('GEN2')
      expect(existsSync(join(dir, 'f.bak'))).toBe(true)
      expect(existsSync(join(dir, 'f.tmp'))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('V6-28: a failed post-rename remove keeps the partial-commit disclosure (0.3.36)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evo-commands-atomic-rmfail-'))
    try {
      writeFileSync(join(dir, 'a'), 'OLD-A', 'utf8')
      writeFileSync(join(dir, 'b'), 'OLD-B', 'utf8')
      // `a` commits; for `b` the first rename fails AND the remove-then-rename
      // recovery ALSO cannot remove the target (Windows: rename and unlink
      // failing together with EPERM). The error must still disclose that `a`
      // landed — the raw rm failure used to escape without the chain.
      const fsOps = {
        ...baseFs,
        renameSync: (from: string) => {
          if (from.endsWith('b.tmp')) throw new Error('EPERM: rename failed')
          renameSync(from, join(dir, 'a'))
        },
        // Only the target-remove fails; the stage cleanup (.tmp) must still work.
        rmSync: (path: string, options?: { force?: boolean; recursive?: boolean }) => {
          if (path.endsWith('.tmp')) { rmSync(path, options); return }
          throw new Error('EPERM: unlink failed')
        },
      }
      let message = ''
      try {
        Commands.atomicWriteFiles(dir, [{ name: 'a', content: 'NEW-A' }, { name: 'b', content: 'NEW-B' }], fsOps)
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect(message).toContain('could not remove "b" to replace it')
      expect(message).toContain('already committed: a')
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('V6-42: duplicate input names fail loud instead of self-referentially removing the committed file (0.3.36)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evo-commands-atomic-dup-'))
    try {
      writeFileSync(join(dir, 'f'), 'OLD', 'utf8')
      let message = ''
      try {
        Commands.atomicWriteFiles(dir, [{ name: 'f', content: 'NEW-1' }, { name: 'f', content: 'NEW-2' }])
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect(message).toContain('duplicate input names: f')
      expect(readFileSync(join(dir, 'f'), 'utf8')).toBe('OLD')
      expect(existsSync(join(dir, 'f.tmp'))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
})
