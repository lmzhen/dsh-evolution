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
  const isMissing = (error: unknown): boolean => {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    return code === 'ENOENT' || code === 'ENOTDIR'
  }
  const provider: EvolutionIo = {
    name: 'node',
    async readText(path) {
      try { return await readFile(path, 'utf8') } catch (error) {
        // Only "missing" maps to null; any other read failure surfaces so a
        // caller never mistakes an unreadable store for an empty one.
        if (isMissing(error)) return null
        throw error
      }
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
      // absent and let re-archives overwrite older archives). Non-missing
      // stat failures surface instead of hiding as "not there".
      try { await stat(path); return true } catch (error) {
        if (isMissing(error)) return false
        throw error
      }
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
      try { return (await stat(path)).size } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },
  }
  ctx.effect(() => ctx.evolutionIo.registerProvider(provider), 'evolution-io-node.provider')
}
