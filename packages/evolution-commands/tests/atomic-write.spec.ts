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
      await rm(dir, { recursive: true, force: true })
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
      await rm(dir, { recursive: true, force: true })
    }
  })
})
