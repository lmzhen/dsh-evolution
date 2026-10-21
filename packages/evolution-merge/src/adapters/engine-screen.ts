/**
 * G3 screen adapter: cards -> corpus snapshot -> EnginePort.screen.
 *
 * The vendor engine reads a corpus from disk; host cards are content. This module
 * writes only SKILL.md support-free snapshots under the run directory. It does not
 * decide candidates: the Q02 selector is injected so engine/report-map stays the
 * single source of that policy.
 */
import { join } from 'node:path'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { MergeCandidate } from '../contracts.ts'
import type { SkillCard } from '../screening.ts'

export type EngineScreenResult =
  | { readonly ok: true; readonly report: Record<string, unknown> }
  | { readonly ok: false; readonly error: { readonly code: string; readonly stage?: string; readonly detail?: string } }

export interface EngineScreenPort {
  screen(input: {
    readonly corpusDir: string
    readonly outDir: string
    readonly cfg?: Record<string, unknown>
    readonly signal?: AbortSignal
    readonly onProgress?: (p: { stage: string; done?: number; total?: number }) => void
  }): Promise<EngineScreenResult>
}

export interface CandidateSelection {
  readonly candidates: readonly MergeCandidate[]
  readonly skipped: readonly { readonly pairKey: string; readonly a: string; readonly b: string; readonly reason?: string }[]
  readonly reportOnly: number
}

export interface EngineScreeningDeps {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly engine: EngineScreenPort
  readonly select: (report: Record<string, unknown>) => CandidateSelection
  readonly cfg?: Record<string, unknown>
  readonly onSelection?: (selection: CandidateSelection, runId: string) => Promise<void>
}

function safeName(name: string, index: number): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return (cleaned === '' ? 'skill-' + String(index) : cleaned) + '__' + String(index)
}

/** Write the exact card bodies as a support-free corpus snapshot and return its root. */
export async function snapshotCards(io: EvolutionIoLike, home: string, runId: string, cards: readonly SkillCard[]): Promise<string> {
  const root = join(home, 'merge', 'runs', runId, 'corpus')
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index]
    if (card === undefined) continue
    await io.writeText(join(root, safeName(card.name, index), 'SKILL.md'), card.body)
  }
  return root
}

export function createEngineScreening(deps: EngineScreeningDeps) {
  return async (cards: readonly SkillCard[], runId: string, signal: AbortSignal): Promise<readonly MergeCandidate[]> => {
    const corpusDir = await snapshotCards(deps.io, deps.home, runId, cards)
    const outDir = join(deps.home, 'merge', 'runs', runId, 'engine')
    const result = await deps.engine.screen({
      corpusDir,
      outDir,
      ...(deps.cfg === undefined ? {} : { cfg: deps.cfg }),
      signal,
    })
    if (!result.ok) {
      throw new Error('engine screen failed: ' + result.error.code + (result.error.stage === undefined ? '' : ' @' + result.error.stage) + (result.error.detail === undefined ? '' : ': ' + result.error.detail))
    }
    const selection = deps.select(result.report)
    if (deps.onSelection !== undefined) await deps.onSelection(selection, runId)
    return selection.candidates
  }
}
