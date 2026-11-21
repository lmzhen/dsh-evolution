// @tier pre-tag
import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { platformEvolutionIo, type PlatformFs } from '../src/io-platform.ts'

it('drives the real platform fs-local backend through the EvolutionIo adapter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evolution-io-platform-real-'))
  try {
    const ctx = new Context()
    const fs = new LocalFileSystem(ctx, { cwd: root, diffBasisMaxBytes: 1_048_576 })
    const io = platformEvolutionIo(fs as unknown as PlatformFs)
    const path = join(root, 'skills', 'real', 'SKILL.md')
    await io.writeText(path, 'one')
    expect(await io.readText(path)).toBe('one')
    expect(await io.size(path)).toBe(3)
    await io.transact!(path, async (current) => {
      expect(current).toBe('one')
      return 'two'
    })
    expect(await io.readText(path)).toBe('two')
    await expect(io.createTextIfAbsent!(path, 'three')).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await io.readText(path)).toBe('two')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
