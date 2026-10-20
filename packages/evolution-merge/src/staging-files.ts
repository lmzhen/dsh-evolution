/**
 * Staged file operations used by the authoring tool.
 *
 * The child never receives a general filesystem write. Every path is resolved under
 * <run>/sources/<source>/ or <run>/merged/<target>/ and must stay there; the staging
 * manifest supplies the target name. Reads are three-state, writes are atomic at the
 * file level, and copy only goes sources -> merged.
 */
import { join } from 'node:path'
import {
  isPresent,
  probeUnknown,
  type EvolutionIoLike,
  type Probe,
} from '@deepseek-ai/dsh-evolution-core'
import { readStaging, stagingRoot } from './staging.ts'

export type StageArea = 'sources' | 'merged'

export type StageWriteResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly message: string }

function safeRelative(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.startsWith('\\') || path.includes('\0')) return false
  return path.replace(/\\/g, '/').split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

function areaRoot(home: string, runId: string, target: string, area: StageArea, source?: string): string | null {
  const root = stagingRoot(home, runId)
  if (area === 'merged') return join(root, 'merged', target)
  if (source === undefined || source === '') return null
  return join(root, 'sources', source)
}

export async function writeStagedFile(
  io: EvolutionIoLike,
  home: string,
  runId: string,
  path: string,
  content: string,
  source?: string,
): Promise<StageWriteResult> {
  if (!safeRelative(path)) return { ok: false, message: 'unsafe staged path: ' + path }
  const staging = await readStaging(io, home, runId)
  if (!isPresent(staging)) return { ok: false, message: 'staging is not present for run ' + runId }
  const root = areaRoot(home, runId, staging.value.manifest.target, 'merged', source)
  if (root === null) return { ok: false, message: 'staged write requires merged area' }
  const target = join(root, ...path.split('/'))
  try {
    await io.writeText(target, content)
    return { ok: true, path }
  } catch (error) {
    return { ok: false, message: 'staged write failed: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

export async function readStagedFile(
  io: EvolutionIoLike,
  home: string,
  runId: string,
  path: string,
  area: StageArea,
  source?: string,
): Promise<Probe<string>> {
  if (!safeRelative(path)) return probeUnknown('unsafe staged path: ' + path)
  const staging = await readStaging(io, home, runId)
  if (!isPresent(staging)) return staging.kind === 'absent' ? { kind: 'absent' } : probeUnknown(staging.reason)
  const root = areaRoot(home, runId, staging.value.manifest.target, area, source)
  if (root === null) return probeUnknown('missing source name for sources area')
  try {
    const value = await io.readText(join(root, ...path.split('/')))
    return value === null ? { kind: 'absent' } : { kind: 'present', value }
  } catch (error) {
    return probeUnknown('staged read failed: ' + (error instanceof Error ? error.message : String(error)))
  }
}

export async function listStagedFiles(
  io: EvolutionIoLike,
  home: string,
  runId: string,
  area: StageArea,
  path = '',
  source?: string,
): Promise<Probe<readonly string[]>> {
  if (path !== '' && !safeRelative(path)) return probeUnknown('unsafe staged path: ' + path)
  const staging = await readStaging(io, home, runId)
  if (!isPresent(staging)) return staging.kind === 'absent' ? { kind: 'absent' } : probeUnknown(staging.reason)
  const root = areaRoot(home, runId, staging.value.manifest.target, area, source)
  if (root === null) return probeUnknown('missing source name for sources area')
  try {
    const entries = await io.list(join(root, ...path.split('/').filter(Boolean)))
    return { kind: 'present', value: [...entries].sort() }
  } catch (error) {
    return probeUnknown('staged list failed: ' + (error instanceof Error ? error.message : String(error)))
  }
}

/** Copy one source file into the merged target; the only cross-area operation allowed. */
export async function copyStagedFile(
  io: EvolutionIoLike,
  home: string,
  runId: string,
  source: string,
  from: string,
  to: string,
): Promise<StageWriteResult> {
  if (!safeRelative(from) || !safeRelative(to)) return { ok: false, message: 'unsafe staged copy path' }
  const sourceFile = await readStagedFile(io, home, runId, from, 'sources', source)
  if (!isPresent(sourceFile)) return { ok: false, message: 'source file is not readable: ' + from }
  return await writeStagedFile(io, home, runId, to, sourceFile.value)
}
