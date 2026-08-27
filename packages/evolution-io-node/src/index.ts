/**
 * Local atomic node:fs IO provider.
 * @module @deepseek-ai/dsh-evolution-io-node
 */

import type { Context } from '@deepseek-ai/cordis'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { EvolutionIo } from '@deepseek-ai/dsh-evolution-io'

export const name = 'evolution-io-node'
export const inject = ['evolutionIo']

export function apply(ctx: Context): void {
  const provider: EvolutionIo = {
    name: 'node',
    async readText(path) {
      try { return await readFile(path, 'utf8') } catch { return null }
    },
    async writeText(path, content) {
      await mkdir(dirname(path), { recursive: true })
      const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
      await writeFile(tmp, content, 'utf8')
      await rename(tmp, path)
    },
    async remove(path) { await rm(path, { recursive: true, force: true }) },
    async list(path) {
      try { return await readdir(path) } catch { return [] }
    },
    async exists(path) {
      // stat, not readFile: directories must report true (readFile on a
      // directory throws EISDIR, which used to make .archive/<name> look
      // absent and let re-archives overwrite older archives).
      try { await stat(path); return true } catch { return false }
    },
    async rename(path, destination) {
      await mkdir(dirname(destination), { recursive: true })
      await rename(path, destination)
    },
    async copy(path, destination) {
      await mkdir(dirname(destination), { recursive: true })
      await cp(path, destination, { recursive: true, force: true })
    },
    async size(path) {
      // Swallowed: a missing or unreadable file reports "unknown size".
      try { return (await stat(path)).size } catch { return null }
    },
  }
  ctx.effect(() => ctx.evolutionIo.registerProvider(provider), 'evolution-io-node.provider')
}
