/**
 * Skill-tree manifest: the content-addressed inventory of one UnitKernel tree
 * unit. The manifest is stored as an ordinary MVCC content object and the
 * commit's `tree` ref names it, so a snapshot query can return the exact tree
 * that the commit published without re-listing the skill directory.
 *
 * The generator is pure; `publishTreeManifest` only writes the content object.
 * Wiring the result into the UnitKernel commit is the R6 follow-up.
 *
 * @module @deepseek-ai/dsh-evolution-core/store/tree-manifest
 */

import { createHash } from 'node:crypto'
import type { TreeChangeOp } from '../unit-kernel.ts'
import { StoreKernel } from './store-kernel.ts'
import type { StoreTreeRef } from './types.ts'

export interface TreeManifestEntry {
  /** Slash-normalized path relative to the skill tree root. */
  readonly path: string
  /** `file` carries content; `deleted` records a removal in this unit. */
  readonly kind: 'file' | 'deleted'
  readonly sha256?: string | undefined
  readonly size?: number | undefined
}

export interface TreeManifest {
  readonly version: 1
  readonly unitId: string
  /** Sorted by path so the same unit produces the same manifest bytes. */
  readonly entries: readonly TreeManifestEntry[]
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/** One changed file after a committed unit; null content is a deletion. */
export interface TreeManifestFile {
  readonly path: string
  readonly content: string | null
}

/** Build the canonical manifest from committed file contents. */
export function buildTreeManifestFiles(unitId: string, files: readonly TreeManifestFile[]): TreeManifest {
  const seen = new Map<string, TreeManifestEntry>()
  for (const file of files) {
    const path = file.path.replace(/\\/g, '/')
    seen.set(path, file.content === null
      ? { path, kind: 'deleted' }
      : { path, kind: 'file', sha256: sha256(file.content), size: Buffer.byteLength(file.content, 'utf8') })
  }
  const entries = [...seen.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return { version: 1, unitId, entries }
}

/** Publish a manifest from committed file contents and return the commit tree ref. */
export async function publishTreeManifestFiles(kernel: StoreKernel, unitId: string, files: readonly TreeManifestFile[]): Promise<StoreTreeRef> {
  const manifest = buildTreeManifestFiles(unitId, files)
  const id = await kernel.putObject(manifest)
  return { unitId, manifest: id }
}

/** Build the canonical manifest for one tree unit's changed files. */
export function buildTreeManifest(unitId: string, ops: readonly TreeChangeOp[]): TreeManifest {
  const entries: TreeManifestEntry[] = []
  for (const op of ops) {
    const path = op.target.replace(/\\/g, '/')
    if (op.kind === 'write') {
      entries.push({ path, kind: 'file', sha256: sha256(op.content), size: Buffer.byteLength(op.content, 'utf8') })
    } else {
      entries.push({ path, kind: 'deleted' })
    }
  }
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  // Duplicate targets are last-write-wins in the kernel; keep the manifest
  // consistent with that by keeping the last entry for each path.
  const unique: TreeManifestEntry[] = []
  const seen = new Map<string, TreeManifestEntry>()
  for (const entry of entries) seen.set(entry.path, entry)
  for (const entry of seen.values()) unique.push(entry)
  unique.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return { version: 1, unitId, entries: unique }
}

/** Publish the manifest as an immutable object and return the commit tree ref. */
export async function publishTreeManifest(kernel: StoreKernel, unitId: string, ops: readonly TreeChangeOp[]): Promise<StoreTreeRef> {
  const manifest = buildTreeManifest(unitId, ops)
  const id = await kernel.putObject(manifest)
  return { unitId, manifest: id }
}

/** Resolve the manifest a commit's tree ref names; null when the ref has none. */
export async function readTreeManifest(kernel: StoreKernel, tree: StoreTreeRef | null): Promise<TreeManifest | null> {
  if (tree?.manifest === undefined) return null
  const value = await kernel.getObject(tree.manifest)
  if (typeof value !== 'object' || value === null) throw new Error('tree manifest is not an object')
  const record = value as { version?: unknown; unitId?: unknown; entries?: unknown }
  if (record.version !== 1 || typeof record.unitId !== 'string' || !Array.isArray(record.entries)) throw new Error('tree manifest has an invalid shape')
  return value as TreeManifest
}
