/** Display-only row ordering for merge tabs; never part of the wire read. */
import type { MergeQueue } from './api.ts'

const PREFIX = 'dsh-evolution-merge.row-order.v1'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type RowOrderEdge = 'top' | 'bottom'

/** Workspace scope for one tab. A missing panel workspace is the local scope. */
export function resolveWorkspaceId(workspaceId: string | null | undefined): string {
  const value = workspaceId?.trim() ?? ''
  return value === '' ? 'local' : value
}

/** Stable localStorage key for one workspace and queue. */
export function rowOrderKey(workspaceId: string | null | undefined, queue: MergeQueue): string {
  return PREFIX + ':' + encodeURIComponent(resolveWorkspaceId(workspaceId)) + ':' + queue
}

function defaultStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function normalize(raw: string | null): readonly string[] {
  if (raw === null) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    const ids: string[] = []
    const seen = new Set<string>()
    for (const item of value) {
      if (typeof item !== 'string' || item === '' || seen.has(item)) continue
      seen.add(item)
      ids.push(item)
    }
    return ids
  } catch {
    return []
  }
}

/** One tab's persisted order; failures degrade to an empty (wire) order. */
export function createRowOrderStore(storage: StorageLike | undefined = defaultStorage()): {
  read(workspaceId: string | null | undefined, queue: MergeQueue): readonly string[]
  write(workspaceId: string | null | undefined, queue: MergeQueue, ids: readonly string[]): void
} {
  return {
    read(workspaceId, queue) {
      if (storage === undefined) return []
      try { return normalize(storage.getItem(rowOrderKey(workspaceId, queue))) } catch { return [] }
    },
    write(workspaceId, queue, ids) {
      if (storage === undefined) return
      try { storage.setItem(rowOrderKey(workspaceId, queue), JSON.stringify(ids)) } catch { /* quota/private mode: display-only best effort */ }
    },
  }
}

/** Apply persisted ids first, then append unknown rows in their wire order. */
export function orderRows<T extends { readonly id: string }>(rows: readonly T[], order: readonly string[]): readonly T[] {
  if (order.length === 0) return rows
  const byId = new Map(rows.map(row => [row.id, row]))
  const out: T[] = []
  const seen = new Set<string>()
  for (const id of order) {
    const row = byId.get(id)
    if (row === undefined || seen.has(id)) continue
    seen.add(id)
    out.push(row)
  }
  for (const row of rows) if (!seen.has(row.id)) out.push(row)
  return out
}

/** Move one visible row before another; unknown ids leave the order unchanged. */
export function moveRow(order: readonly string[], fromId: string, beforeId: string | undefined): readonly string[] {
  if (!order.includes(fromId)) return order
  const rest = order.filter(id => id !== fromId)
  if (beforeId === undefined) return [...rest, fromId]
  const index = rest.indexOf(beforeId)
  if (index < 0) return [...rest, fromId]
  return [...rest.slice(0, index), fromId, ...rest.slice(index)]
}

/** Pin one visible row to the top or bottom of the full visible order. */
export function pinRow(order: readonly string[], id: string, edge: RowOrderEdge): readonly string[] {
  if (!order.includes(id)) return order
  const rest = order.filter(item => item !== id)
  return edge === 'top' ? [id, ...rest] : [...rest, id]
}
