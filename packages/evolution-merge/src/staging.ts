/**
 * Staging is a run ARTIFACT, not a queue: <home>/merge/runs/<runId>/.
 *
 * createStaging writes a sibling .partial tree first and renames it into place; the .stage
 * marker is the last write inside the partial. A directory without that marker is a
 * half-created artifact and reads as unknown, never as "empty".
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  isPresent,
  probeAbsent,
  probePresent,
  probeText,
  probeUnknown,
  type EvolutionIoLike,
  type Probe,
} from '@deepseek-ai/dsh-evolution-core'

export const STAGING_SCHEMA_VERSION = 1

export function stageKeyOf(runId: string, pairKey: string): string {
  return runId + '/pairs/' + createHash('sha256').update(pairKey).digest('hex').slice(0, 16)
}

export function stagingRoot(home: string, runId: string): string {
  return join(home, 'merge', 'runs', runId)
}

export interface StagingSource {
  readonly name: string
  readonly body: string
  readonly files: readonly { readonly path: string; readonly content: string }[]
}

export interface StagingManifest {
  readonly schemaVersion: typeof STAGING_SCHEMA_VERSION
  readonly runId: string
  readonly target: string
  readonly mode?: 'merge-into-existing' | 'create-umbrella' | 'keep'
  readonly sources: readonly string[]
  readonly promptVersion: string
  readonly createdAt: number
  readonly expiresAt: number
}

export interface CreateStagingInput {
  readonly runId: string
  readonly target: string
  readonly mode?: 'merge-into-existing' | 'create-umbrella' | 'keep'
  readonly sources: readonly StagingSource[]
  readonly promptVersion: string
  readonly ttlDays: number
  readonly now: () => number
}

export type CreateStagingResult =
  | { readonly ok: true; readonly path: string; readonly manifest: StagingManifest }
  | { readonly ok: false; readonly message: string }

/** Relative support paths only; the staging tree must never escape its run directory. */
function safeRelative(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.startsWith('\\') || path.includes('\0')) return false
  return path.replace(/\\/g, '/').split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

function manifestText(manifest: StagingManifest): string {
  return JSON.stringify(manifest, null, 2) + '\n'
}

export async function createStaging(io: EvolutionIoLike, home: string, input: CreateStagingInput): Promise<CreateStagingResult> {
  const final = stagingRoot(home, input.runId)
  if (await io.exists(final)) return { ok: false, message: 'staging already exists for run ' + input.runId }
  const names = new Set<string>()
  for (const source of input.sources) {
    if (names.has(source.name)) return { ok: false, message: 'duplicate source ' + source.name }
    names.add(source.name)
    for (const file of source.files) {
      if (!safeRelative(file.path)) return { ok: false, message: 'unsafe support path: ' + file.path }
    }
  }
  const partial = final + '.partial'
  try {
    await io.remove(partial)
    for (const source of input.sources) {
      const dir = join(partial, 'sources', source.name)
      await io.writeText(join(dir, 'SKILL.md'), source.body)
      for (const file of source.files) {
        await io.writeText(join(dir, ...file.path.split('/')), file.content)
      }
    }
    const at = input.now()
    const manifest: StagingManifest = {
      schemaVersion: STAGING_SCHEMA_VERSION,
      runId: input.runId,
      target: input.target,
      ...(input.mode === undefined ? {} : { mode: input.mode }),
      sources: input.sources.map(source => source.name),
      promptVersion: input.promptVersion,
      createdAt: at,
      expiresAt: at + Math.max(0, input.ttlDays) * 86_400_000,
    }
    await io.writeText(join(partial, 'manifest.json'), manifestText(manifest))
    // Marker last: its absence is the half-created signal readStaging reports as unknown.
    await io.writeText(join(partial, '.stage'), '')
    await io.rename(partial, final)
    return { ok: true, path: final, manifest }
  } catch (error) {
    try { await io.remove(partial) } catch { /* best effort */ }
    return { ok: false, message: 'staging create failed: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

export interface StagedView {
  readonly path: string
  readonly manifest: StagingManifest
}

export async function readStaging(io: EvolutionIoLike, home: string, runId: string): Promise<Probe<StagedView>> {
  const path = stagingRoot(home, runId)
  if (!await io.exists(path)) return probeAbsent()
  if (!await io.exists(join(path, '.stage'))) return probeUnknown('staging ' + runId + ' has no .stage marker (half-created)')
  const probe = await probeText(io, join(path, 'manifest.json'))
  if (!isPresent(probe)) return probe
  try {
    const parsed = JSON.parse(probe.value) as Partial<StagingManifest>
    if (parsed.schemaVersion !== STAGING_SCHEMA_VERSION || parsed.runId !== runId || typeof parsed.target !== 'string' || !Array.isArray(parsed.sources)) {
      return probeUnknown('staging manifest has an unexpected shape')
    }
    return probePresent({ path, manifest: parsed as StagingManifest })
  } catch (error) {
    return probeUnknown('staging manifest is not JSON: ' + (error instanceof Error ? error.message : String(error)))
  }
}

export async function ensureStaging(io: EvolutionIoLike, home: string, input: CreateStagingInput): Promise<CreateStagingResult> {
  const existing = await readStaging(io, home, input.runId)
  if (existing.kind === 'present') return { ok: true, path: stagingRoot(home, input.runId), manifest: existing.value.manifest }
  return createStaging(io, home, input)
}

export async function setStagingTarget(io: EvolutionIoLike, home: string, stageKey: string, target: string, mode?: 'merge-into-existing' | 'create-umbrella' | 'keep'): Promise<boolean> {
  const view = await readStaging(io, home, stageKey)
  if (view.kind !== 'present') return false
  const manifest = Object.assign({}, view.value.manifest, { target }, mode === undefined ? {} : { mode })
  await io.writeText(join(stagingRoot(home, stageKey), 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return true
}

export async function dropStaging(io: EvolutionIoLike, home: string, stageKey: string): Promise<void> {
  await io.remove(stagingRoot(home, stageKey))
}

