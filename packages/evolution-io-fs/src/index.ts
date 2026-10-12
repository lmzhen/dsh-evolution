/**
 * Platform-`ctx.fs` IO provider — the seam's SECOND backend (G2 S0).
 *
 * Why this package exists: the family's durable IO used to be one hand-written node stack
 * (core's `nodeEvolutionIo`) with its own lock protocol and its own atomic write. The platform
 * already ships all of it (`ctx.fs` with per-target locking and `writeText(target, text, expected)`
 * version CAS), and two families of implementation is exactly how invariants drift. This provider
 * maps the family seam onto the platform one, so `evolution-io-node` becomes one of two choices
 * instead of the only medium.
 *
 * S0 (this step) ADDS the provider and does NOT enable it: `apply()` registers it WITHOUT
 * `default: true`, so `provider()` still resolves the node backend and no behaviour changes.
 * `evolution-io-node` remains the default until S3 flips it.
 *
 * Gaps are declared, not hidden (contract C2): the platform `FileSystem` has no
 * `mkdir/remove/rename/copy` (upstream request ①) and its `FsInfo` carries no wall-clock mtime
 * (request ②). Those methods therefore FALL BACK to the node backend and are listed in
 * {@link PLATFORM_IO_FALLBACKS}; when upstream lands them the list shrinks to empty, which is the
 * measurable 'delete the temporary shape' condition.
 *
 * @module @deepseek-ai/dsh-evolution-io-fs
 */
import type { Context } from '@deepseek-ai/cordis'
import { nodeEvolutionIo, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionIo } from '@deepseek-ai/dsh-evolution-io'

/** Provider name in the `evolutionIo` registry. */
export const PROVIDER_NAME = 'fs'

/** The seam methods the platform FileSystem cannot serve yet (contract C2 fallback list). */
export const PLATFORM_IO_FALLBACKS = ['remove', 'rename', 'copy'] as const

/** The platform `ctx.fs` surface this provider needs — a structural view, so the family adds no
 * dependency. Only the members actually used are declared. */
interface FsLike {
  resolve(path: string): Promise<unknown>
  stat(target: unknown): Promise<{ size?: number; version?: unknown } | undefined>
  lstat(path: string): Promise<{ symlink?: boolean } | undefined>
  readText(target: unknown): Promise<string>
  listDir(target: unknown): Promise<Array<{ name: string }>>
  writeText(target: unknown, content: string, expected?: FsWriteIntentLike): Promise<unknown>
}

/** The platform write intent (dsh-fs types): omit it for an unconditional create-or-overwrite. */
type FsWriteIntentLike =
  | { kind: 'createIfAbsent' }
  | { kind: 'replaceIfVersion'; version: unknown }

/** The two platform error codes a guarded write reports when another writer won the race. */
const VERSION_CONFLICT_CODES = new Set(['FS_STALE_VERSION', 'FS_NOT_OBSERVED'])

/** @returns whether the error is the platform's optimistic-concurrency conflict. */
function isVersionConflict(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' && VERSION_CONFLICT_CODES.has(code)
}

/** A missing file is `null` on this seam; a real read failure must stay an error. */
async function readTextThrough(fs: FsLike, path: string): Promise<string | null> {
  const target = await fs.resolve(path)
  try {
    return await fs.readText(target)
  } catch (error) {
    const info = await fs.stat(target).catch(() => undefined)
    if (info === undefined) return null
    throw error
  }
}

/** Build the seam implementation on top of `ctx.fs`, falling back to the node backend for the gaps. */
/**
 * @param ctx - the plugin context (needs the platform `fs` service).
 * @param options.attempts - how many times a conflicted RMW is re-run before the conflict surfaces.
 * @returns the seam implementation backed by the platform filesystem.
 */
export function platformEvolutionIo(
  ctx: { get(name: string): unknown },
  options: { attempts?: number } = {},
): EvolutionIoLike {
  const attempts = options.attempts ?? 3
  // platform-declaration anchor: reads the platform's `fs` service (optional; undefined or an incomplete
  // surface ⇒ the provider refuses to build rather than silently degrading to a second file stack).
  const fs = ctx.get('fs') as FsLike | undefined
  if (fs === undefined || typeof fs.resolve !== 'function' || typeof fs.writeText !== 'function') {
    throw new Error('evolution-io-fs: the platform fs service is not mounted — the platform provider cannot be built')
  }
  const fallback = nodeEvolutionIo()
  return {
    readText: path => readTextThrough(fs, path),
    async writeText(path, content) {
      await fs.writeText(await fs.resolve(path), content)
    },
    async exists(path) {
      return (await fs.stat(await fs.resolve(path)).catch(() => undefined)) !== undefined
    },
    async size(path) {
      const info = await fs.stat(await fs.resolve(path)).catch(() => undefined)
      if (info === undefined) return null
      return typeof info.size === 'number' ? info.size : null
    },
    async list(path) {
      const target = await fs.resolve(path)
      const entries = await fs.listDir(target).catch(() => [] as Array<{ name: string }>)
      return entries.map(entry => entry.name)
    },
    async isSymlink(path) {
      const info = await fs.lstat(path).catch(() => undefined)
      if (info === undefined) return null
      return info.symlink === true
    },
    // Optimistic RMW (S3): the platform serializes each write and offers version guards, but it has
    // no cross-process read-modify-write lock — so this is a bounded retry loop, not a second lock
    // protocol. A conflict means another writer committed; the task is re-run on the FRESH content.
    async transact(path, task) {
      const target = await fs.resolve(path)
      for (let attempt = 1; ; attempt += 1) {
        const info = await fs.stat(target).catch(() => undefined)
        const current = info === undefined ? null : await readTextThrough(fs, path)
        const next = await task(current)
        if (next === null) {
          // Deletion is a declared gap (no platform remove): the node backend owns it until upstream
          // ships one. The CAS below therefore cannot cover deletes — recorded in PLATFORM_IO_FALLBACKS.
          await fallback.remove(path)
          return
        }
        if (next === current) return
        const intent: FsWriteIntentLike =
          info === undefined ? { kind: 'createIfAbsent' } : { kind: 'replaceIfVersion', version: info.version }
        try {
          await fs.writeText(target, next, intent)
          return
        } catch (error) {
          if (!isVersionConflict(error) || attempt >= attempts) throw error
        }
      }
    },
    // Declared gaps (C2): the mutations the platform surface does not carry yet.
    remove: path => fallback.remove(path),
    rename: (path, destination) => fallback.rename(path, destination),
    copy: (path, destination) => fallback.copy(path, destination),
  }
}

// Compile-time satisfiability: a drift between the seam and this provider fails tsc.
export function providerFor(ctx: { get(name: string): unknown }): EvolutionIo {
  return { name: PROVIDER_NAME, ...platformEvolutionIo(ctx) }
}

export const name = 'evolution-io-fs'
export const inject = ['evolutionIo']

/**
 * S0: register the platform provider as an ALTERNATIVE. No default: true — the node backend stays
 * the default until S3 flips it, so mounting this row changes no behaviour by itself.
 */
export function apply(ctx: Context): void {
  const view = ctx as unknown as { get(name: string): unknown }
  ctx.effect(() => ctx.evolutionIo.registerProvider(providerFor(view)), 'evolution-io-fs.provider')
}
