/**
 * Platform-backed `EvolutionIo` provider.
 *
 * This is the Phase-B bridge: business code keeps its existing `EvolutionIoLike`
 * seam, while the production backend becomes the platform filesystem
 * (`ctx.fs`, implemented by `@deepseek-ai/dsh-fs-local`) instead of the family's
 * own `node:fs` writer. Target identity, per-target locks and atomic publication
 * therefore have one owner: the platform.
 *
 * Structural `PlatformFs` is deliberate: this package consumes the platform
 * service shape without adding a runtime dependency; every operation is a
 * one-to-one mapping, and no plugin-local write primitive is introduced.
 *
 * @module @deepseek-ai/dsh-evolution-core/io-platform
 */

import type { Context } from '@deepseek-ai/cordis'
import type { EvolutionIo } from './io-registry.ts'

interface PlatformTarget {
  readonly targetKey: string
  readonly displayPath: string
}

interface PlatformInfo {
  readonly version: string
  readonly type: string
  readonly size?: number
}

interface PlatformWriteIntent {
  readonly kind: 'createIfAbsent' | 'replaceIfVersion'
  readonly version?: string
}

interface PlatformEdit {
  readonly oldString: string
  readonly newString: string
  readonly replaceAll: boolean
}

/** The public subset of `ctx.fs` this adapter consumes. */
export interface PlatformFs {
  resolve(path: string): Promise<PlatformTarget>
  stat(target: PlatformTarget): Promise<PlatformInfo | undefined>
  readText(target: PlatformTarget): Promise<string>
  writeText(target: PlatformTarget, content: string, expected?: PlatformWriteIntent): Promise<unknown>
  editText(target: PlatformTarget, edit: PlatformEdit, expected?: { readonly version: string }): Promise<unknown>
  deleteFile(target: PlatformTarget, expected?: { readonly version: string }): Promise<unknown>
  listDir(target: PlatformTarget): Promise<Array<{ readonly name: string }>>
  moveFile(source: PlatformTarget, destination: PlatformTarget, options: unknown): Promise<{ readonly sourceDeleted: boolean }>
  lstat(path: string): Promise<{ readonly type: string } | undefined>
}

const MISSING_CODES = new Set(['FS_NOT_FOUND', 'FS_NOT_DIRECTORY', 'ENOENT', 'ENOTDIR'])

function codeOf(error: unknown): string {
  return typeof (error as { code?: unknown } | undefined)?.code === 'string' ? String((error as { code: string }).code) : ''
}

function isMissing(error: unknown): boolean {
  return MISSING_CODES.has(codeOf(error))
}

function eexist(message: string): Error {
  return Object.assign(new Error(message), { code: 'EEXIST' })
}

async function readOrNull(fs: PlatformFs, path: string): Promise<string | null> {
  const target = await fs.resolve(path)
  try {
    return await fs.readText(target)
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

/**
 * Adapt one platform filesystem service to the family's existing IO seam.
 * @param fs - the platform filesystem service (structurally `ctx.fs`).
 * @returns the provider, ready for `ctx.evolutionIo.registerProvider`.
 */
export function platformEvolutionIo(fs: PlatformFs): EvolutionIo {
  return {
    name: 'platform',
    processScope: 'single-process',
    async readText(path) {
      return await readOrNull(fs, path)
    },
    async writeText(path, content) {
      const target = await fs.resolve(path)
      await fs.writeText(target, content)
    },
    async remove(path) {
      const target = await fs.resolve(path)
      try {
        await fs.deleteFile(target)
      } catch (error) {
        if (!isMissing(error)) throw error
      }
    },
    async list(path) {
      const target = await fs.resolve(path)
      try {
        return (await fs.listDir(target)).map((entry) => entry.name)
      } catch (error) {
        // EvolutionIoLike contract: a missing directory reads as empty; any
        // other failure surfaces so an unreadable tree is never silent.
        if (isMissing(error)) return []
        throw error
      }
    },
    async exists(path) {
      const target = await fs.resolve(path)
      try {
        return (await fs.stat(target)) !== undefined
      } catch (error) {
        if (isMissing(error)) return false
        throw error
      }
    },
    async rename(path, destination) {
      const source = await fs.resolve(path)
      const target = await fs.resolve(destination)
      const outcome = await fs.moveFile(source, target, {})
      if (outcome.sourceDeleted !== true) throw new Error('platform move retained the source: ' + path)
    },
    async copy(path, destination) {
      const content = await readOrNull(fs, path)
      if (content === null) throw new Error('cannot copy missing file: ' + path)
      const target = await fs.resolve(destination)
      await fs.writeText(target, content)
    },
    async size(path) {
      const target = await fs.resolve(path)
      const info = await fs.stat(target)
      return info === undefined || info.type !== 'file' ? null : info.size ?? null
    },
    async isSymlink(path) {
      const info = await fs.lstat(path)
      return info === undefined ? null : info.type === 'symlink'
    },
    async createTextIfAbsent(path, content) {
      const target = await fs.resolve(path)
      try {
        await fs.writeText(target, content, { kind: 'createIfAbsent' })
      } catch (error) {
        if (codeOf(error) === 'FS_ALREADY_EXISTS' || codeOf(error) === 'FS_STALE_VERSION' || codeOf(error) === 'FS_NOT_OBSERVED') {
          throw eexist('target appeared before create: ' + path)
        }
        throw error
      }
    },
    async transact(path, task) {
      const target = await fs.resolve(path)
      const info = await fs.stat(target)
      const current = info === undefined ? null : await fs.readText(target)
      const next = await task(current)
      if (next === current) return
      if (next === null) {
        if (info === undefined) return
        await fs.deleteFile(target, { version: info.version })
        return
      }
      if (info === undefined) {
        try {
          await fs.writeText(target, next, { kind: 'createIfAbsent' })
        } catch (error) {
          if (codeOf(error) === 'FS_ALREADY_EXISTS' || codeOf(error) === 'FS_STALE_VERSION' || codeOf(error) === 'FS_NOT_OBSERVED') {
            throw eexist('target appeared before write: ' + path)
          }
          throw error
        }
        return
      }
      // A whole-file literal replacement is the platform's guarded read→write
      // critical section. Empty files cannot express a non-empty oldString.
      if (current === null) throw new Error('platform file vanished during transact: ' + path)
      if (current === '') await fs.writeText(target, next, { kind: 'replaceIfVersion', version: info.version })
      else await fs.editText(target, { oldString: current, newString: next, replaceAll: false }, { version: info.version })
    },
  }
}

export const name = 'evolution-io-platform'
export const inject = ['evolutionIo', 'fs']

/**
 * Register the platform provider as the default IO backend.
 * @param ctx - plugin context carrying `evolutionIo` and `fs`.
 */
export function apply(ctx: Context): void {
  const fs = (ctx as unknown as { readonly fs?: PlatformFs }).fs
  if (fs === undefined) throw new Error('evolution-io-platform requires the platform fs service')
  ctx.effect(() => ctx.evolutionIo.registerProvider(platformEvolutionIo(fs), { default: true }), 'evolution-io-platform.provider')
}
