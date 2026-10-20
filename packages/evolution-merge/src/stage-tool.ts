/**
 * The pure half of the model-facing merge_stage tool.
 *
 * Registration/session binding lives in the plugin shell; this function owns the rules a
 * caller cannot bypass: only the bound merge child, and only the author phase may write.
 */
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import {
  copyStagedFile,
  listStagedFiles,
  readStagedFile,
  writeStagedFile,
  type StageArea,
} from './staging-files.ts'

export type StagePhase = 'decide' | 'author'

export interface StageToolContext {
  readonly runId: string
  readonly childId: string
  readonly expectedChildId: string
  readonly phase: StagePhase
}

export type StageToolOp =
  | { readonly op: 'list'; readonly area: StageArea; readonly path?: string; readonly source?: string }
  | { readonly op: 'read'; readonly area: StageArea; readonly path: string; readonly source?: string }
  | { readonly op: 'write'; readonly path: string; readonly content: string }
  | { readonly op: 'copy'; readonly source: string; readonly from: string; readonly to: string }

export type StageToolResult =
  | { readonly ok: true; readonly value?: unknown }
  | { readonly ok: false; readonly code: 'not-merge-child' | 'phase' | 'not-found' | 'io' | 'bad-path'; readonly message: string }

export async function applyStageTool(io: EvolutionIoLike, home: string, ctx: StageToolContext, op: StageToolOp): Promise<StageToolResult> {
  if (ctx.childId !== ctx.expectedChildId) return { ok: false, code: 'not-merge-child', message: 'merge_stage is only available to the bound merge child' }
  if (op.op === 'write' || op.op === 'copy') {
    if (ctx.phase !== 'author') return { ok: false, code: 'phase', message: 'merge_stage write/copy is only allowed in the author phase' }
  }
  if (op.op === 'list') {
    const result = await listStagedFiles(io, home, ctx.runId, op.area, op.path ?? '', op.source)
    return probeResult(result, 'list')
  }
  if (op.op === 'read') {
    const result = await readStagedFile(io, home, ctx.runId, op.path, op.area, op.source)
    return probeResult(result, 'read')
  }
  if (op.op === 'write') {
    const result = await writeStagedFile(io, home, ctx.runId, op.path, op.content)
    return result.ok ? { ok: true, value: { path: result.path } } : { ok: false, code: 'io', message: result.message }
  }
  const result = await copyStagedFile(io, home, ctx.runId, op.source, op.from, op.to)
  return result.ok ? { ok: true, value: { path: result.path } } : { ok: false, code: 'io', message: result.message }
}

function probeResult<T>(probe: { readonly kind: 'present'; readonly value: T } | { readonly kind: 'absent' } | { readonly kind: 'unknown'; readonly reason: string }, what: string): StageToolResult {
  if (probe.kind === 'present') return { ok: true, value: probe.value }
  if (probe.kind === 'absent') return { ok: false, code: 'not-found', message: what + ': not found' }
  return { ok: false, code: 'io', message: what + ': ' + probe.reason }
}
