/**
 * Authoring flow: create the staging tree, let the author write it, run the deterministic
 * rule gate, then commit through the injected CommitPort. The channel adapter and the
 * author tool live outside; this is the seam they share.
 */
import type { EvolutionIoLike, UnitTransaction } from '@deepseek-ai/dsh-evolution-core'
import { createStaging, setStagingTarget } from './staging.ts'
import { readStagedTree } from './staged-tree.ts'
import { validateStagedTree, hasBlockingFinding, type RuleFinding } from './rules.ts'
import { commitStagedRun, type CommitPort, type CommitStagedResult } from './commit-execute.ts'
import type { StagedTree } from './rules.ts'
import type { SkillCard } from './skill-card.ts'

export interface RunAuthoringOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly runId: string
  readonly stageKey?: string
  readonly reuseStaging?: boolean
  readonly target: string
  readonly mode?: 'merge-into-existing' | 'create-umbrella' | 'keep'
  readonly cards: readonly SkillCard[]
  readonly author: (staging: { readonly home: string; readonly runId: string }) => Promise<string>
  readonly commitPort: CommitPort
  readonly now: () => number
  readonly summary: string
  readonly isBlocked?: (name: string) => boolean | Promise<boolean>
  readonly unit?: UnitTransaction | undefined
}

export type AuthoringResult =
  | { readonly ok: true; readonly tree: StagedTree; readonly commit: Extract<CommitStagedResult, { readonly ok: true }> }
  | { readonly ok: false; readonly message: string; readonly findings?: readonly RuleFinding[] }

export async function runAuthoring(options: RunAuthoringOptions): Promise<AuthoringResult> {
  const targetCard = options.cards.find(card => card.name === options.target)
  const mode = options.mode ?? (targetCard === undefined ? 'create-umbrella' : 'merge-into-existing')
  const createMode = mode === 'create-umbrella'
  if (!createMode && targetCard !== undefined) {
    if (targetCard.managed !== true) return { ok: false, message: 'target is not family-managed: ' + options.target }
    if (targetCard.protectionUnknown === true || targetCard.protectedBy != null) return { ok: false, message: 'target is protected (' + (targetCard.protectedBy ?? 'unknown') + '): ' + options.target }
  }
  if (!createMode && await options.isBlocked?.(options.target) === true) return { ok: false, message: 'target is blocked by curator: ' + options.target }
  const stageKey = options.stageKey ?? options.runId
  if (options.reuseStaging === true) {
    if (!await setStagingTarget(options.io, options.home, stageKey, options.target, mode)) return { ok: false, message: 'staging missing or unreadable: ' + stageKey }
  } else {
    const created = await createStaging(options.io, options.home, {
      runId: stageKey,
      target: options.target,
      mode,
      sources: options.cards.map(card => ({ name: card.name, body: card.body, files: card.files ?? [] })),
      promptVersion: 'merge-b/v1',
      ttlDays: 7,
      now: options.now,
    })
    if (!created.ok) return { ok: false, message: created.message }
  }
  try {
    await options.author({ home: options.home, runId: stageKey })
  } catch (error) {
    return { ok: false, message: 'author failed: ' + (error instanceof Error ? error.message : String(error)) }
  }
  const tree = await readStagedTree(options.io, options.home, stageKey)
  if (tree.kind !== 'present') return { ok: false, message: 'staged tree is not readable: ' + (tree.kind === 'unknown' ? tree.reason : 'absent') }
  const findings = validateStagedTree(tree.value)
  if (hasBlockingFinding(findings)) return { ok: false, message: 'staged tree failed the rule gate', findings }
  const commit = await commitStagedRun(options.io, options.home, stageKey, options.commitPort, {
    origin: 'foreground',
    summary: options.summary,
    now: options.now,
    ...(options.isBlocked === undefined ? {} : { isBlocked: options.isBlocked }),
    ...(options.unit === undefined ? {} : { unit: options.unit }),
  })
  if (!commit.ok) return { ok: false, message: commit.message }
  return { ok: true, tree: tree.value, commit }
}
