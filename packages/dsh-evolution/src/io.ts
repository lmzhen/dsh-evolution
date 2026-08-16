/**
 * Structural IO seam for the legacy facade stores.
 *
 * The facade accepts any object exposing this small async file-tree surface.
 * Native DSH packages pass `ctx.evolutionIo.provider()`; standalone consumers
 * (and the facade's own tests) can use `nodeEvolutionIo`.
 */

import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

export interface EvolutionIoLike {
  readText(path: string): Promise<string | null>
  writeText(path: string, content: string): Promise<void>
  remove(path: string): Promise<void>
  list(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  rename(path: string, destination: string): Promise<void>
  copy(path: string, destination: string): Promise<void>
}

export function nodeEvolutionIo(): EvolutionIoLike {
  return {
    async readText(path) {
      try { return await readFile(path, 'utf8') } catch { return null }
    },
    async writeText(path, content) {
      await mkdir(dirname(path), { recursive: true })
      const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
      await writeFile(tmp, content, 'utf8')
      await rename(tmp, path)
    },
    async remove(path) {
      await rm(path, { recursive: true, force: true })
    },
    async list(path) {
      try { return await readdir(path) } catch { return [] }
    },
    async exists(path) {
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
  }
}

/** Absolute path helper kept separate so stores stay platform-correct. */
export function childPath(parent: string, ...parts: string[]): string {
  return join(parent, ...parts)
}
