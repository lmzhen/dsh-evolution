/**
 * Transition adapter: expose a directory of legacy files as one MVCC domain
 * map (`path -> text`), while delegating every other path to the base IO.
 *
 * The merge package writes one `run-meta/<id>.json` file per run and one
 * `reports/*` file per result. This adapter maps those two file sets into the
 * `mergeMeta` and `reports` domains so a v2 home has one commit for ledger,
 * run metadata and report bodies; dot-prefixed lock files stay on the base
 * medium. It is a migration bridge, not a second medium.
 *
 * @module @deepseek-ai/dsh-evolution-core/store/scoped-tree-io
 */

import { existsSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import type { EvolutionIoLike } from '../io.ts'
import { liveHomeFence } from '../mutation-authority.ts'
import { StoreKernel } from './store-kernel.ts'
import { scopedTextIO } from './scoped-text-io.ts'
import type { StoreService } from './service.ts'
import type { StoreDomainId, StoreWriterFence } from './types.ts'
import { STATE_V2_MIGRATION_MARKER } from '../state/constants.ts'

type FileMap = Record<string, string>

const recordOf = (value: unknown): FileMap => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: FileMap = {}
  for (const [key, entry] of Object.entries(value)) if (typeof entry === 'string') out[key] = entry
  return out
}

export interface ScopedTreeMapping {
  /** Directory relative to `home`, e.g. `merge/run-meta`. */
  readonly prefix: string
  readonly domain: StoreDomainId
}

export interface ScopedTreeIOOptions {
  readonly home: string
  readonly mappings: readonly ScopedTreeMapping[]
  readonly kernel: StoreKernel
  /** When present, reads/writes go through the unified surface service. */
  readonly service?: StoreService | undefined
  readonly commandId?: string | undefined
}

/** Wrap base IO with directory→domain mappings; dot-prefixed lock files stay on base. */
export function scopedTreeIO(base: EvolutionIoLike, options: ScopedTreeIOOptions): EvolutionIoLike {
  const root = resolve(options.home)
  const prefixes = options.mappings.map(mapping => ({ ...mapping, prefix: mapping.prefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') }))
  const relativeKey = (path: string): string => relative(root, resolve(path)).replace(/\\/g, '/')
  const mapped = (path: string): { domain: StoreDomainId; key: string } | undefined => {
    const key = relativeKey(path)
    if (basename(key).startsWith('.')) return undefined
    for (const entry of prefixes) {
      if (key === entry.prefix) continue
      if (key.startsWith(entry.prefix + '/')) return { domain: entry.domain, key }
    }
    return undefined
  }

  const readMap = async (domain: StoreDomainId): Promise<FileMap> => {
    const snapshot = options.service === undefined
      ? await options.kernel.query([domain])
      : (await options.service.query(options.commandId ?? 'merge', [domain])).snapshot
    return recordOf(snapshot.domains[domain])
  }
  const writeMap = async (domain: StoreDomainId, key: string, text: string | null): Promise<void> => {
    const change = async (current: { domains: Partial<Record<StoreDomainId, unknown>> }): Promise<Record<string, FileMap>> => {
      const map = recordOf(current.domains[domain])
      if (text === null) delete map[key]
      else map[key] = text
      return { [domain]: map }
    }
    if (options.service !== undefined) {
      await options.service.command({
        commandId: options.commandId ?? 'merge',
        domains: [domain],
        source: 'command',
        change,
      })
      return
    }
    await options.kernel.mutate({ domains: [domain], source: 'command', change })
  }

  const partial: Omit<EvolutionIoLike, 'remove' | 'rename' | 'copy'> = {
    get processScope() { return base.processScope },
    async readText(path) {
      const target = mapped(path)
      if (target === undefined) return await base.readText(path)
      return (await readMap(target.domain))[target.key] ?? null
    },
    async writeText(path, content) {
      const target = mapped(path)
      if (target === undefined) {
        await base.writeText(path, content)
        return
      }
      await writeMap(target.domain, target.key, content)
    },
    async createTextIfAbsent(path, content) {
      const target = mapped(path)
      if (target === undefined) {
        if (base.createTextIfAbsent === undefined) throw new Error('scoped-tree-io: base IO has no createTextIfAbsent')
        await base.createTextIfAbsent(path, content)
        return
      }
      if ((await readMap(target.domain))[target.key] !== undefined) throw Object.assign(new Error('scoped-tree-io: mapped file exists'), { code: 'EEXIST' })
      await writeMap(target.domain, target.key, content)
    },
    async transact(path, task) {
      const target = mapped(path)
      if (target === undefined) {
        if (base.transact === undefined) throw new Error('scoped-tree-io: base IO has no transact')
        await base.transact(path, task)
        return
      }
      const change = async (current: { domains: Partial<Record<StoreDomainId, unknown>> }): Promise<Record<string, FileMap>> => {
        const map = recordOf(current.domains[target.domain])
        const previous = map[target.key] ?? null
        const next = await task(previous)
        if (next === null) delete map[target.key]
        else map[target.key] = next
        return { [target.domain]: map }
      }
      if (options.service !== undefined) {
        await options.service.command({ commandId: options.commandId ?? 'merge', domains: [target.domain], source: 'command', change })
        return
      }
      await options.kernel.mutate({ domains: [target.domain], source: 'command', change })
    },
    async list(path) {
      const key = relativeKey(path).replace(/\/+$/, '')
      const mapping = prefixes.find(entry => entry.prefix === key)
      if (mapping === undefined) return await base.list(path)
      const map = await readMap(mapping.domain)
      const prefix = key === '' ? '' : key + '/'
      const names = new Set<string>()
      for (const file of Object.keys(map)) {
        if (!file.startsWith(prefix)) continue
        const rest = file.slice(prefix.length)
        const name = rest.split('/')[0]
        if (name !== undefined && name !== '') names.add(name)
      }
      return [...names]
    },
    async exists(path) {
      const target = mapped(path)
      if (target === undefined) return await base.exists(path)
      return (await readMap(target.domain))[target.key] !== undefined
    },
    size: async (path) => {
      const target = mapped(path)
      if (target === undefined) return base.size === undefined ? null : await base.size(path)
      const text = (await readMap(target.domain))[target.key]
      return text === undefined ? null : Buffer.byteLength(text, 'utf8')
    },
    isSymlink: async (path) => {
      const target = mapped(path)
      if (target === undefined) return base.isSymlink === undefined ? null : await base.isSymlink(path)
      return (await readMap(target.domain))[target.key] === undefined ? null : false
    },
    mtime: async (path) => {
      const target = mapped(path)
      if (target === undefined) return base.mtime === undefined ? null : await base.mtime(path)
      return null
    },
  }

  const adapter: EvolutionIoLike = {
    ...partial,
    remove: async (path) => {
      const target = mapped(path)
      if (target === undefined) {
        await base.remove(path)
        return
      }
      await writeMap(target.domain, target.key, null)
    },
    rename: async (path, destination) => {
      const from = mapped(path)
      const to = mapped(destination)
      if (from === undefined && to === undefined) {
        await base.rename(path, destination)
        return
      }
      const text = from === undefined ? await base.readText(path) : (await readMap(from.domain))[from.key] ?? null
      if (text === null) throw new Error('scoped-tree-io: source is missing')
      if (to === undefined) await base.writeText(destination, text)
      else await writeMap(to.domain, to.key, text)
      if (from !== undefined) await writeMap(from.domain, from.key, null)
    },
    copy: async (path, destination) => {
      const from = mapped(path)
      const to = mapped(destination)
      if (from === undefined && to === undefined) {
        await base.copy(path, destination)
        return
      }
      const text = from === undefined ? await base.readText(path) : (await readMap(from.domain))[from.key] ?? null
      if (text === null) throw new Error('scoped-tree-io: source is missing')
      if (to === undefined) await base.writeText(destination, text)
      else await writeMap(to.domain, to.key, text)
    },
  }
  return adapter
}

/** One kernel/one view for merge state plus its run-meta/report files. */
export function mergeIoIfV2(
  ctx: { get?(name: string): unknown } | undefined,
  base: EvolutionIoLike,
  home: string,
  fence?: StoreWriterFence | undefined,
  service?: StoreService | undefined,
): EvolutionIoLike | undefined {
  if (!existsSync(join(home, 'state', STATE_V2_MIGRATION_MARKER))) return undefined
  const kernel = new StoreKernel({ io: base, home, fence: fence ?? liveHomeFence(ctx ?? {}, home) })
  const serviceOptions = service === undefined ? {} : { service, commandId: 'merge' }
  const stateIo = scopedTextIO(base, { path: join(home, 'merge', 'merge-state.json'), domain: 'merge', kernel, ...serviceOptions })
  return scopedTreeIO(stateIo, {
    home,
    kernel,
    ...serviceOptions,
    mappings: [
      { prefix: 'merge/run-meta', domain: 'mergeMeta' },
      { prefix: 'reports', domain: 'reports' },
    ],
  })
}
