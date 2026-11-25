/**
 * Transition adapter: expose one legacy text file as a domain of the home MVCC
 * store, without changing the consumers that still speak `EvolutionIoLike`.
 *
 * The merge state stack historically owns one path (`merge/merge-state.json`)
 * through `readText`/`transactIo`. This adapter maps exactly that path to the
 * `merge` domain as `{ text }`, delegates every other path to the real IO seam,
 * and publishes writes through the one HomeFence. It is a migration bridge, not
 * a second medium: no file is written for the mapped path, and R7 replaces the
 * callers with the query/command ports.
 *
 * @module @deepseek-ai/dsh-evolution-core/store/scoped-text-io
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { EvolutionIoLike } from '../io.ts'
import { liveHomeFence } from '../mutation-authority.ts'
import { StoreKernel } from './store-kernel.ts'
import type { StoreService } from './service.ts'
import type { StoreDomainId, StoreWriterFence } from './types.ts'
import { STATE_V2_MIGRATION_MARKER } from '../state/constants.ts'
import { suppressedFile, usageFile } from '../usage.ts'

export interface ScopedTextIOOptions {
  /** Absolute path of the single mapped file. */
  readonly path: string
  /** MVCC domain that owns the file text. */
  readonly domain: StoreDomainId
  readonly kernel: StoreKernel
  /** When present, reads/writes go through the unified surface service. */
  readonly service?: StoreService | undefined
  readonly commandId?: string | undefined
}

const textOf = (value: unknown): string | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const text = (value as { text?: unknown }).text
  return typeof text === 'string' ? text : null
}

/** Wrap one base IO and map exactly `options.path` to one MVCC domain. */
export function scopedTextIO(base: EvolutionIoLike, options: ScopedTextIOOptions): EvolutionIoLike {
  const target = resolve(options.path)
  const isTarget = (path: string): boolean => resolve(path) === target

  const readMapped = async (): Promise<string | null> => {
    const snapshot = options.service === undefined
      ? await options.kernel.query([options.domain])
      : (await options.service.query(options.commandId ?? 'usage.rw', [options.domain])).snapshot
    return textOf(snapshot.domains[options.domain])
  }

  const writeMapped = async (text: string): Promise<void> => {
    const change = (): Record<string, unknown> => ({ [options.domain]: { text } })
    if (options.service !== undefined) {
      await options.service.command({
        commandId: options.commandId ?? 'usage.rw',
        domains: [options.domain],
        source: 'command',
        change,
      })
      return
    }
    await options.kernel.mutate({ domains: [options.domain], source: 'command', change })
  }
  const clearMapped = async (): Promise<void> => {
    const change = (): Record<string, unknown> => ({ [options.domain]: null })
    if (options.service !== undefined) {
      await options.service.command({
        commandId: options.commandId ?? 'usage.rw',
        domains: [options.domain],
        source: 'command',
        change,
      })
      return
    }
    await options.kernel.mutate({ domains: [options.domain], source: 'command', change })
  }

  const partial: Omit<EvolutionIoLike, 'remove' | 'rename' | 'copy'> = {
    get processScope() { return base.processScope },
    async readText(path) {
      return isTarget(path) ? await readMapped() : await base.readText(path)
    },
    async writeText(path, content) {
      if (isTarget(path)) {
        await writeMapped(content)
        return
      }
      await base.writeText(path, content)
    },
    async createTextIfAbsent(path, content) {
      if (isTarget(path)) {
        if (await readMapped() !== null) throw Object.assign(new Error('scoped-text-io: mapped file exists'), { code: 'EEXIST' })
        await writeMapped(content)
        return
      }
      if (base.createTextIfAbsent === undefined) throw new Error('scoped-text-io: base IO has no createTextIfAbsent')
      await base.createTextIfAbsent(path, content)
    },
    async transact(path, task) {
      if (!isTarget(path)) {
        if (base.transact === undefined) throw new Error('scoped-text-io: base IO has no transact')
        await base.transact(path, task)
        return
      }
      await options.kernel.mutate({
        domains: [options.domain],
        source: 'command',
        change: async (current) => {
          const previous = textOf(current.domains[options.domain])
          const next = await task(previous)
          if (next === null) return { [options.domain]: null }
          return { [options.domain]: { text: next } }
        },
      })
    },
    async list(path) {
      return await base.list(path)
    },
    async exists(path) {
      return isTarget(path) ? await readMapped() !== null : await base.exists(path)
    },
    size: async (path) => {
      if (!isTarget(path)) return base.size === undefined ? null : await base.size(path)
      const text = await readMapped()
      return text === null ? null : Buffer.byteLength(text, 'utf8')
    },
    isSymlink: async (path) => {
      if (isTarget(path)) {
        return (await readMapped()) === null ? null : false
      }
      return base.isSymlink === undefined ? null : await base.isSymlink(path)
    },
    mtime: async (path) => {
      if (isTarget(path)) return (await readMapped()) === null ? null : null
      return base.mtime === undefined ? null : await base.mtime(path)
    },
  }
  // Property syntax (not object methods) keeps the io-discipline gate's
  // "one write facade" shape: a bare method named remove/rename/copy reads as
  // a raw call to the gate.
  const adapter: EvolutionIoLike = {
    ...partial,
    remove: async (path) => {
      if (isTarget(path)) {
        await clearMapped()
        return
      }
      await base.remove(path)
    },
    rename: async (path, destination) => {
      if (isTarget(path) || isTarget(destination)) {
        if (isTarget(path) && isTarget(destination)) {
          const text = await readMapped()
          if (text === null) throw new Error('scoped-text-io: mapped file is missing')
          await writeMapped(text)
          return
        }
        if (isTarget(path)) {
          throw new Error('scoped-text-io: the mapped file cannot be renamed away through this adapter')
        }
        const text = await base.readText(path)
        if (text === null) throw new Error('scoped-text-io: source is missing')
        await writeMapped(text)
        return
      }
      await base.rename(path, destination)
    },
    copy: async (path, destination) => {
      if (isTarget(path)) {
        const text = await readMapped()
        if (text === null) throw new Error('scoped-text-io: mapped file is missing')
        if (isTarget(destination)) {
          await writeMapped(text)
          return
        }
        await base.writeText(destination, text)
        return
      }
      if (isTarget(destination)) {
        const text = await base.readText(path)
        if (text === null) throw new Error('scoped-text-io: source is missing')
        await writeMapped(text)
        return
      }
      await base.copy(path, destination)
    },
  }
  return adapter
}

/** Map the two memory documents into their own domains under the v2 marker. */
export function memoryIoIfV2(
  ctx: { get?(name: string): unknown } | undefined,
  base: EvolutionIoLike,
  home: string,
  memoryRootPath: string,
  fence?: StoreWriterFence | undefined,
): EvolutionIoLike | undefined {
  if (!existsSync(join(home, 'state', STATE_V2_MIGRATION_MARKER))) return undefined
  const kernel = new StoreKernel({ io: base, home, fence: fence ?? liveHomeFence(ctx ?? {}, home) })
  return scopedTextIO(
    scopedTextIO(base, { path: join(memoryRootPath, 'MEMORY.md'), domain: 'memoryFile', kernel }),
    { path: join(memoryRootPath, 'USER.md'), domain: 'userFile', kernel },
  )
}

/** Map usage + curator-suppressed sidecars into their domains under the v2 marker. */
export function usageSidecarIoIfV2(
  ctx: { get?(name: string): unknown } | undefined,
  base: EvolutionIoLike,
  skillsRoot: string,
  options: { readonly home?: string | undefined; readonly fence?: StoreWriterFence | undefined; readonly service?: StoreService | undefined } = {},
): EvolutionIoLike | undefined {
  const home = options.home ?? join(skillsRoot, '..', 'evolution')
  if (!existsSync(join(home, 'state', STATE_V2_MIGRATION_MARKER))) return undefined
  const kernel = new StoreKernel({ io: base, home, fence: options.fence ?? liveHomeFence(ctx ?? {}, home) })
  const service = options.service === undefined ? {} : { service: options.service, commandId: 'usage.rw' }
  return scopedTextIO(
    scopedTextIO(base, { path: usageFile(skillsRoot), domain: 'usage', kernel, ...service }),
    { path: suppressedFile(skillsRoot), domain: 'suppressed', kernel, ...service },
  )
}

export interface DiscoveryPaths {
  readonly domainMap: string
  readonly projectionJournal: string
  readonly viewSnapshots: string
}

/** Map the three discovery JSON documents into their own domains under the v2 marker. */
export function discoveryIoIfV2(
  ctx: { get?(name: string): unknown } | undefined,
  base: EvolutionIoLike,
  home: string,
  paths: DiscoveryPaths,
  fence?: StoreWriterFence | undefined,
): EvolutionIoLike | undefined {
  if (!existsSync(join(home, 'state', STATE_V2_MIGRATION_MARKER))) return undefined
  const kernel = new StoreKernel({ io: base, home, fence: fence ?? liveHomeFence(ctx ?? {}, home) })
  return scopedTextIO(
    scopedTextIO(
      scopedTextIO(base, { path: paths.domainMap, domain: 'domainMap', kernel }),
      { path: paths.projectionJournal, domain: 'projectionJournal', kernel },
    ),
    { path: paths.viewSnapshots, domain: 'viewSnapshots', kernel },
  )
}
