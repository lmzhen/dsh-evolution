import { readTextOrNull } from './read-probe.ts'
/** Batch 1b-2a pre-1b backup manifest. Read-only, idempotent, no production normalize. */
import { createHash } from 'node:crypto'
import { chmod, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'

export interface Pre1bFileEntry {
  readonly source: string
  readonly copy: string
  readonly sha256: string
  readonly bytes: number
  readonly mode: string
}
export interface Pre1bTreeEntry {
  readonly source: string
  readonly copy: string
  readonly sha256: string
  readonly files: number
  readonly bytes: number
}
export interface Pre1bBackupManifest {
  readonly version: 1
  readonly backupId: string
  readonly sourceSchema: 3
  readonly sourceStateSha256: string
  readonly createdAt: string
  readonly state: Pre1bFileEntry
  readonly trees: readonly Pre1bTreeEntry[]
  readonly files: readonly Pre1bFileEntry[]
  readonly readonly: true
}
export type Pre1bBackupResult =
  | { readonly ok: true; readonly id: string; readonly path: string; readonly manifest: Pre1bBackupManifest }
  | { readonly ok: false; readonly code: 'pre-1b-backup-conflict' | 'pre-1b-backup-invalid' | 'pre-1b-backup-failed'; readonly message: string }

export function pre1bRoot(home: string): string { return join(home, 'merge', '.backup', 'pre-1b') }
export function pre1bDir(home: string, id: string): string { return join(pre1bRoot(home), id) }
export function pre1bManifestPath(home: string, id: string): string { return join(pre1bDir(home, id), 'manifest.json') }
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')
const statePath = (home: string): string => join(home, 'merge', 'merge-state.json')

async function walk(io: EvolutionIoLike, root: string, rel = ''): Promise<string[]> {
  const path = rel === '' ? root : join(root, rel)
  if (!await io.exists(path)) return []
  try {
    const text = await io.readText(path)
    if (text !== null) return [rel]
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String((error as { code?: unknown }).code) : ''
    if (code !== 'EISDIR' && code !== 'ENOTDIR') throw error
  }
  const names = await io.list(path)
  const found: string[] = []
  for (const name of names.sort()) found.push(...await walk(io, root, rel === '' ? name : join(rel, name)))
  return found
}

async function chmodReadOnly(path: string): Promise<string> {
  await chmod(path, 0o444)
  const info = await stat(path)
  const mode = (info.mode & 0o777).toString(8).padStart(4, '0')
  if ((info.mode & 0o222) !== 0) throw new Error('backup is not read-only: ' + path)
  return mode
}

export async function readPre1bManifest(io: EvolutionIoLike, home: string, id: string): Promise<Pre1bBackupManifest | null> {
  const raw = await readTextOrNull(io, pre1bManifestPath(home, id))
  if (raw === null) return null
  try {
    const value = JSON.parse(raw) as Partial<Pre1bBackupManifest>
    if (value.version !== 1 || value.readonly !== true || value.sourceSchema !== 3 || typeof value.sourceStateSha256 !== 'string' || !Array.isArray(value.trees) || !Array.isArray(value.files) || value.state === undefined) return null
    return value as Pre1bBackupManifest
  } catch { return null }
}

/** Create or reuse the single pre-1b backup. Never writes merge-state. */
export async function createPre1bBackup(io: EvolutionIoLike, home: string, at = new Date().toISOString()): Promise<Pre1bBackupResult> {
  const raw = await readTextOrNull(io, statePath(home))
  if (raw === null) return { ok: false, code: 'pre-1b-backup-invalid', message: 'merge state is missing' }
  let state: { schemaVersion?: unknown }
  try { state = JSON.parse(raw) as { schemaVersion?: unknown } } catch { return { ok: false, code: 'pre-1b-backup-invalid', message: 'merge state is not JSON' } }
  if (state.schemaVersion !== 3) return { ok: false, code: 'pre-1b-backup-invalid', message: 'pre-1b backup requires schema3 state' }
  const stateSha = hash(raw)
  const id = 'pre-1b-' + stateSha.slice(0, 16)
  const existing = await readPre1bManifest(io, home, id)
  if (existing !== null) return { ok: true, id, path: pre1bManifestPath(home, id), manifest: existing }
  const target = pre1bDir(home, id)
  const stateBytes = await io.readText(statePath(home))
  if (stateBytes === null) return { ok: false, code: 'pre-1b-backup-failed', message: 'merge state disappeared' }
  const files: Pre1bFileEntry[] = []
  const trees: Pre1bTreeEntry[] = []
  try {
    const sources: { source: string; kind: 'file' | 'tree' }[] = [
      { source: join(home, 'merge', 'staging-index'), kind: 'tree' },
      { source: join(home, 'merge', 'runs'), kind: 'tree' },
      { source: join(home, 'merge', 'run-meta'), kind: 'tree' },
      { source: join(home, 'reports'), kind: 'tree' },
      { source: join(home, 'merge', 'receipts'), kind: 'tree' },
      { source: join(home, 'merge', 'journals'), kind: 'tree' },
      { source: join(home, 'merge', 'unit-journals'), kind: 'tree' },
      { source: join(home, 'merge', 'units'), kind: 'tree' },
      { source: join(home, 'merge', 'merge-state.v2.bak.json'), kind: 'file' },
      { source: join(home, 'merge', 'merge-state.migration.json'), kind: 'file' },
      { source: join(home, 'merge', 'merge-state.migration.report.json'), kind: 'file' },
      { source: join(home, 'merge', 'merge-state.quarantine.json'), kind: 'file' },
      { source: join(home, 'merge', 'pair-index.json'), kind: 'file' },
      { source: join(home, 'merge', 'recovery.json'), kind: 'file' },
      { source: join(home, 'runs.json'), kind: 'file' },
    ]
    for (const item of sources) {
      if (item.kind === 'file') {
        const text = await readTextOrNull(io, item.source)
        if (text === null) continue
        const rel = item.source.slice(home.length + 1)
        const copy = join(target, 'snapshot', rel)
        await io.copy(item.source, copy)
        const mode = await chmodReadOnly(copy)
        files.push({ source: item.source, copy, sha256: hash(text), bytes: Buffer.byteLength(text, 'utf8'), mode })
      } else {
        const rels = await walk(io, item.source)
        if (rels.length === 0) continue
        let bytes = 0
        const hashes: string[] = []
        for (const rel of rels) {
          const source = join(item.source, rel)
          const text = await io.readText(source)
          if (text === null) continue
          bytes += Buffer.byteLength(text, 'utf8')
          hashes.push(rel + ':' + hash(text))
          const copy = join(target, 'snapshot', item.source.slice(home.length + 1), rel)
          await io.copy(source, copy)
          await chmodReadOnly(copy)
        }
        trees.push({ source: item.source, copy: join(target, 'snapshot', item.source.slice(home.length + 1)), sha256: hash(hashes.sort().join('\n')), files: hashes.length, bytes })
      }
    }
    const stateCopy = join(target, 'snapshot', 'merge', 'merge-state.json')
    await io.copy(statePath(home), stateCopy)
    const stateMode = await chmodReadOnly(stateCopy)
    const stateEntry: Pre1bFileEntry = { source: statePath(home), copy: stateCopy, sha256: stateSha, bytes: Buffer.byteLength(raw, 'utf8'), mode: stateMode }
    const manifest: Pre1bBackupManifest = { version: 1, backupId: id, sourceSchema: 3, sourceStateSha256: stateSha, createdAt: at, state: stateEntry, trees, files, readonly: true }
    await io.writeText(pre1bManifestPath(home, id), JSON.stringify(manifest, null, 2) + '\n')
    await chmodReadOnly(pre1bManifestPath(home, id))
    return { ok: true, id, path: pre1bManifestPath(home, id), manifest }
  } catch (error) {
    return { ok: false, code: 'pre-1b-backup-failed', message: error instanceof Error ? error.message : String(error) }
  }
}
