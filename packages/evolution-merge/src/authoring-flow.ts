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
import type { RevisionRef } from './contracts.ts'
import type { SkillCard } from './skill-card.ts'
import { DEFAULT_SKILL_LIMITS, type SkillLimits } from '@deepseek-ai/dsh-evolution-core'
import { limitsSnapshotOf } from './domain/merge-limits.ts'
import { buildValidationPlan } from './domain/validation-plan.ts'
import { manifestFilesOf, missingManifestFile, parseAuthoringManifest } from './domain/authoring-manifest.ts'

/** Decision-time anchors threaded from round 1 into the commit CAS. */
export interface CommitRevisionRefs {
  readonly targetRevision?: RevisionRef
  readonly sourceRevisions?: Readonly<Record<string, RevisionRef>>
  readonly supportDigest?: string
}

export interface RunAuthoringOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly runId: string
  readonly stageKey?: string
  readonly reuseStaging?: boolean
  readonly target: string
  /** The two participating source skills; conflict detection is limited to these. */
  readonly sources?: readonly string[]
  readonly mode?: 'merge-into-existing' | 'create-umbrella' | 'keep'
  readonly cards: readonly SkillCard[]
  readonly author: (staging: { readonly home: string; readonly runId: string }) => Promise<string>
  readonly commitPort: CommitPort
  readonly now: () => number
  readonly summary: string
  readonly isBlocked?: (name: string) => boolean | Promise<boolean>
  readonly unit?: UnitTransaction | undefined
  readonly limits?: SkillLimits
  readonly promptVersion?: string
  readonly promptHash?: string
  /** Propagated to the commit; aborting before the durable point prevents a orphaned commit. */
  readonly signal?: AbortSignal
  /** Round-1 decision anchors; when absent the commit keeps the legacy body-only CAS. */
  readonly revisions?: CommitRevisionRefs
}

export type AuthoringResult =
  | { readonly ok: true; readonly tree: StagedTree; readonly validationPlan: import('./domain/validation-plan.ts').ValidationPlan; readonly commit: Extract<CommitStagedResult, { readonly ok: true }>; readonly lengths: Readonly<Record<string, number>> }
  | { readonly ok: false; readonly code?: string; readonly message: string; readonly findings?: readonly RuleFinding[]; readonly lengths?: Readonly<Record<string, number>> }

export async function runAuthoring(options: RunAuthoringOptions): Promise<AuthoringResult> {
  if (options.target.includes('/') || options.target.includes(':')) return { ok: false, code: 'target-invalid', message: 'target must be a bare skill name: ' + options.target }
  const targetCard = options.cards.find(card => card.name === options.target)
  const mode = options.mode ?? (targetCard === undefined ? 'create-umbrella' : 'merge-into-existing')
  const createMode = mode === 'create-umbrella'
  if (!createMode && targetCard !== undefined) {
    if (targetCard.managed !== true) return { ok: false, code: 'target-not-managed', message: 'target is not family-managed: ' + options.target }
    if (targetCard.protectionUnknown === true || targetCard.protectedBy != null) return { ok: false, code: 'target-protected', message: 'target is protected (' + (targetCard.protectedBy ?? 'unknown') + '): ' + options.target }
  }
  if (!createMode && await options.isBlocked?.(options.target) === true) return { ok: false, code: 'target-blocked', message: 'target is blocked by curator: ' + options.target }
  const stageKey = options.stageKey ?? options.runId
  if (options.reuseStaging === true) {
    if (!await setStagingTarget(options.io, options.home, stageKey, options.target, mode)) return { ok: false, code: 'staging-missing', message: 'staging missing or unreadable: ' + stageKey }
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
    if (!created.ok) return { ok: false, code: 'staging-create', message: created.message }
  }
  let authored: string
  try {
    authored = await options.author({ home: options.home, runId: stageKey })
  } catch (error) {
    return { ok: false, code: 'author-failed', message: 'author failed: ' + (error instanceof Error ? error.message : String(error)) }
  }
  const tree = await readStagedTree(options.io, options.home, stageKey)
  if (tree.kind !== 'present') return { ok: false, code: 'staging-missing', message: 'staged tree is not readable: ' + (tree.kind === 'unknown' ? tree.reason : 'absent') }
  // FR-VAL-03: the same-child path parses the child's files[] declaration too, so a
  // manifest that promises a file the tree does not contain fails here — not only on the
  // new-child approve path.
  const manifest = parseAuthoringManifest(authored)
  const stagedPaths = tree.value.files.map(file => file.path)
  const manifestFiles = manifestFilesOf(manifest, stagedPaths)
  const missing = missingManifestFile(manifestFiles, stagedPaths)
  if (missing !== null) return { ok: false, code: 'merge-manifest-missing', message: 'manifest file missing from staged tree: ' + missing }
  const limitsSnapshot = limitsSnapshotOf(options.limits ?? DEFAULT_SKILL_LIMITS)
  const participants = new Set(options.sources ?? [])
  const supportSources = options.cards.filter(card => participants.has(card.name)).flatMap(card => (card.files ?? []).map(file => ({ path: file.path, content: file.content, source: card.name })))
  const validationPlan = buildValidationPlan({ tree: tree.value, target: options.target, limits: limitsSnapshot, cards: options.cards, supportSources, ...(options.promptVersion === undefined ? {} : { promptVersion: options.promptVersion }), ...(options.promptHash === undefined ? {} : { promptHash: options.promptHash }), supportFiles: tree.value.files.map(file => ({ path: file.path, content: file.content, source: 'staged' })), manifestFiles, existingSupport: (options.cards.find(card => card.name === options.target)?.files ?? []).map(file => file.path) })
  const findings = [...validateStagedTree(tree.value, limitsSnapshot.skillLimits), ...validationPlan.findings]
  const lengths = { bodyBytes: Buffer.byteLength(tree.value.body, 'utf8'), fileBytes: tree.value.files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0), totalBytes: Buffer.byteLength(tree.value.body, 'utf8') + tree.value.files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0) }
  if (hasBlockingFinding(findings)) return { ok: false, code: findings.some(finding => finding.rule === 'limit') ? 'merge-over-limit' : 'merge-validation', message: 'staged tree failed the rule gate', findings, lengths }
  const commit = await commitStagedRun(options.io, options.home, stageKey, options.commitPort, {
    origin: 'foreground',
    summary: options.summary,
    now: options.now,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.isBlocked === undefined ? {} : { isBlocked: options.isBlocked }),
    ...(options.unit === undefined ? {} : { unit: options.unit }),
    limits: limitsSnapshot.skillLimits,
    validationPlan: { planVersion: validationPlan.planVersion, stageDigest: validationPlan.stageDigest, revision: validationPlan.revision, manifestFiles: validationPlan.manifestFiles },
    ...(options.revisions?.targetRevision === undefined ? {} : { targetRevision: options.revisions.targetRevision }),
    ...(options.revisions?.sourceRevisions === undefined ? {} : { sourceRevisions: options.revisions.sourceRevisions }),
    ...(options.revisions?.supportDigest === undefined ? {} : { supportDigest: options.revisions.supportDigest }),
  })
  if (commit.ok) return { ok: true, tree: tree.value, validationPlan, commit, lengths }
  return { ok: false, code: commit.code ?? 'commit-failed', message: commit.message }
}
