/**
 * Round2 with a NEW child (approval after the pending window). The child gets the round2
 * prompt and writes the staging tree; the plugin then runs the same gate/commit path.
 */
import type { EvolutionIoLike, UnitTransaction } from '@deepseek-ai/dsh-evolution-core'
import type { MergeDecision, MergeRow } from './contracts.ts'
import type { SkillCard } from './skill-card.ts'
import type { ConversationChannelLike } from './channel-port.ts'
import { buildRound2Prompt, STANDBY_PROMPT } from './prompts.ts'
import { stageKeyOf, stagingRoot } from './staging.ts'
import { createStageTree, readStageEntry, readStageTree, setStageTreeTarget, dropStage } from './domain/stage-aggregate.ts'
import { pairKey } from './contracts.ts'
import { readStagedTree } from './staged-tree.ts'
import { validateStagedTree, hasBlockingFinding } from './rules.ts'
import { DEFAULT_SKILL_LIMITS } from '@deepseek-ai/dsh-evolution-core'
import { limitsSnapshotOf } from './domain/merge-limits.ts'
import { buildValidationPlan } from './domain/validation-plan.ts'
import { commitStagedRun, type CommitPort } from './commit-execute.ts'
import type { StageToolContext } from './stage-tool.ts'
import type { ScanRound2Outcome } from './scan-run.ts'
import { manifestFilesOf, missingManifestFile, parseAuthoringManifest } from './domain/authoring-manifest.ts'
import { MERGE_PROMPT_VERSION, promptHashOf } from './prompts.ts'

export interface NewChildAuthoringOptions {
  readonly io: EvolutionIoLike
  readonly home: string
  readonly runId: string
  readonly cards: readonly SkillCard[]
  readonly channel: ConversationChannelLike
  readonly parent: unknown
  readonly allow: readonly string[]
  readonly cwd?: string
  readonly timeoutMs: number
  readonly commitPort: CommitPort
  readonly now: () => number
  readonly isBlocked?: (name: string) => boolean | Promise<boolean>
  readonly onChild?: (context: StageToolContext) => void
  readonly onChildClosed?: (childId: string) => void
  readonly unit?: UnitTransaction | undefined
  readonly limits?: import('@deepseek-ai/dsh-evolution-core').SkillLimits
  readonly parentRunId?: string | ((runId: string) => string | undefined)
}

/** Commit-side causes that mean "the world moved"; they must not be retried blindly. */
const STALE_CAUSES: ReadonlySet<string> = new Set(['target-changed', 'source-changed', 'support-changed', 'target-taken', 'target-gone'])

export async function runNewChildAuthoring(
  options: NewChildAuthoringOptions,
  row: MergeRow,
  decision: MergeDecision,
  signal: AbortSignal,
): Promise<ScanRound2Outcome> {
  if (decision.target.includes('/') || decision.target.includes(':')) return { kind: 'failed', failure: { stage: 'author', code: 'target-invalid', message: 'target must be a bare skill name: ' + decision.target, retryable: false, retryFrom: 'none' } }
  const targetCard = options.cards.find(card => card.name === decision.target)
  const createMode = decision.mode === 'create-umbrella'
  if (!createMode && targetCard !== undefined) {
    if (targetCard.managed !== true) return { kind: 'failed', failure: { stage: 'author', code: 'target-not-managed', message: 'target is not family-managed: ' + decision.target, retryable: false, retryFrom: 'none' } }
    if (targetCard.protectionUnknown === true || targetCard.protectedBy != null) return { kind: 'failed', failure: { stage: 'author', code: 'target-protected', message: 'target is protected: ' + decision.target, retryable: false, retryFrom: 'none' } }
  }
  if (!createMode && await options.isBlocked?.(decision.target) === true) return { kind: 'failed', failure: { stage: 'author', code: 'target-blocked', message: 'target is blocked by curator: ' + decision.target, retryable: false, retryFrom: 'none' } }
  const at = options.now()
  // NFR-06: an expired stage is never reused and never re-presented. Drop its tree and
  // index and author into a fresh one; the recorded decision anchors still guard the
  // sources at commit, so re-staging cannot smuggle a stale merge through.
  const stageEntry = await readStageEntry(options.io, options.home, row.id)
  const expiredStage = stageEntry !== null && stageEntry.expiresAt <= at
  // The row's own staging ref wins; otherwise this run authors into its own stage key.
  // The index entry is consulted for TTL only — switching the authoring key to it would
  // break the approve flow, where the reserved entry and the run's tree are separate.
  const stageKey = row.stagingRef ?? stageKeyOf(options.runId, pairKey(row.a, row.b))
  if (expiredStage && stageEntry !== null) await dropStage(options.io, options.home, row.id, stageEntry.ref)
  const existing = expiredStage ? { kind: 'absent' as const } : await readStageTree(options.io, options.home, stageKey)
  if (existing.kind === 'present') {
    await setStageTreeTarget(options.io, options.home, stageKey, decision.target, decision.mode)
  } else {
    const staging = await createStageTree(options.io, options.home, {
      runId: stageKey,
      target: decision.target,
      mode: decision.mode,
      sources: options.cards
        .filter(card => card.name === row.a || card.name === row.b)
        .map(card => ({ name: card.name, body: card.body, files: card.files ?? [] })),
      promptVersion: 'merge-b/v1',
      ttlDays: 7,
      now: options.now,
    })
    if (!staging.ok) return { kind: 'failed', failure: { stage: 'author', code: 'staging-create', message: staging.message, retryable: true, retryFrom: 'agent2' } }
  }
  const opened = await options.channel.open({
    parent: options.parent,
    label: 'merge-round2',
    promptText: STANDBY_PROMPT,
    kind: 'reviewer',
    allow: options.allow,
    cwd: stagingRoot(options.home, stageKey),
    timeoutMs: options.timeoutMs,
    signal,
  })
  if (opened.kind !== 'ok') {
    return { kind: 'failed', failure: { stage: 'author', code: opened.kind, message: opened.kind === 'unavailable' ? opened.reason : 'round2 aborted', retryable: opened.kind !== 'aborted', retryFrom: opened.kind === 'aborted' ? 'none' : 'agent2' } }
  }
  options.onChild?.({ runId: stageKey, childId: opened.childId, expectedChildId: opened.childId, phase: 'author' })
  try {
    if (opened.turn.stopReason !== 'completed') {
      return { kind: 'failed', failure: { stage: 'author', code: opened.turn.stopReason, message: 'standby did not complete', retryable: true, retryFrom: 'agent2' } }
    }
    const turn = await options.channel.continueTurn(opened.childId, buildRound2Prompt(row, decision, 'fresh'), { timeoutMs: options.timeoutMs, signal })
    if (turn.kind !== 'ok') return { kind: 'failed', failure: { stage: 'author', code: turn.kind, message: turn.kind === 'unavailable' ? turn.reason : 'round2 aborted', retryable: turn.kind !== 'aborted', retryFrom: turn.kind === 'aborted' ? 'none' : 'agent2' } }
    if (turn.turn.stopReason !== 'completed') {
      return { kind: 'failed', failure: { stage: 'author', code: turn.turn.stopReason, message: 'round2 did not complete', retryable: true, retryFrom: 'agent2' } }
    }
    const tree = await readStagedTree(options.io, options.home, stageKey)
    if (tree.kind !== 'present') return { kind: 'failed', failure: { stage: 'author', code: 'staging-missing', message: tree.kind === 'unknown' ? tree.reason : 'staged tree absent', retryable: true, retryFrom: 'agent2' } }
    const manifest = parseAuthoringManifest(turn.turn.text)
    const stagedPaths = tree.value.files.map(file => file.path)
    const manifestFiles = manifestFilesOf(manifest, stagedPaths)
    const missing = missingManifestFile(manifestFiles, stagedPaths)
    if (missing !== null) return { kind: 'failed', failure: { stage: 'author', code: 'merge-manifest-missing', message: 'manifest file missing from staged tree: ' + missing, retryable: true, retryFrom: 'agent2' } }
    const limitsSnapshot = limitsSnapshotOf(options.limits ?? DEFAULT_SKILL_LIMITS)
    const validationPlan = buildValidationPlan({ tree: tree.value, target: decision.target, limits: limitsSnapshot, cards: options.cards, promptVersion: MERGE_PROMPT_VERSION, promptHash: promptHashOf(buildRound2Prompt(row, decision)), supportFiles: tree.value.files.map(file => ({ path: file.path, content: file.content, source: 'staged' })), manifestFiles, participants: [row.a, row.b, decision.target], existingSupport: (options.cards.find(card => card.name === decision.target)?.files ?? []).map(file => file.path), supportSources: options.cards.filter(card => card.name === row.a || card.name === row.b).flatMap(card => (card.files ?? []).map(file => ({ path: file.path, content: file.content, source: card.name }))) })
    const findings = [...validateStagedTree(tree.value, limitsSnapshot.skillLimits), ...validationPlan.findings]
    if (hasBlockingFinding(findings)) {
      const lengths = { bodyBytes: Buffer.byteLength(tree.value.body, 'utf8'), fileBytes: tree.value.files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0), totalBytes: Buffer.byteLength(tree.value.body, 'utf8') + tree.value.files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0) }
      // FR-EXEC-11/14: only a LIMIT finding is over-limit (a policy close); every other
      // blocking rule (manifest mismatch, support conflict, validation plan) is a
      // validation failure that goes to the report as failed, never to skipped.
      const limit = findings.find(finding => finding.rule === 'limit')
      const plan = { planVersion: validationPlan.planVersion, stageDigest: validationPlan.stageDigest, revision: validationPlan.revision, manifestFiles: validationPlan.manifestFiles } as const
      return limit === undefined
        ? { kind: 'failed', failure: { stage: 'validate', code: 'merge-validation', message: 'staged tree failed the rule gate', retryable: false, retryFrom: 'none' }, validationPlan: plan, manifestFiles: validationPlan.manifestFiles, validationIssues: findings, criteria: { decision: 'merge', validation: 'required', commit: 'never', archive: 'none', evidence: 'none' } }
        : { kind: 'failed', failure: { stage: 'validate', code: 'merge-over-limit', message: limit.message, retryable: false, retryFrom: 'none', lengths }, validationPlan: plan, manifestFiles: validationPlan.manifestFiles, validationIssues: findings, criteria: { decision: 'merge', validation: 'required', commit: 'never', archive: 'none', evidence: 'none' } }
    }
    const parentRunId = typeof options.parentRunId === 'function' ? options.parentRunId(options.runId) : options.parentRunId
    const commit = await commitStagedRun(options.io, options.home, stageKey, options.commitPort, {
      origin: 'foreground', summary: 'merge ' + row.a + ' + ' + row.b, now: options.now, signal,
      ...(options.isBlocked === undefined ? {} : { isBlocked: options.isBlocked }),
      ...(options.unit === undefined ? {} : { unit: options.unit }),
      ...(options.limits === undefined ? {} : { limits: options.limits }),
      ...(parentRunId === undefined ? {} : { parentRunId }),
      validationPlan: { planVersion: validationPlan.planVersion, stageDigest: validationPlan.stageDigest, revision: validationPlan.revision },
      ...(decision.targetRevisionRef === undefined ? {} : { targetRevision: decision.targetRevisionRef }),
      ...(decision.sourceRevisions === undefined ? {} : { sourceRevisions: decision.sourceRevisions }),
      ...(decision.supportDigest === undefined ? {} : { supportDigest: decision.supportDigest }),
    })
    if (!commit.ok) {
      const code = commit.code ?? 'commit-failed'
      return { kind: 'failed', failure: { stage: 'commit', code, message: commit.message, retryable: !STALE_CAUSES.has(code), retryFrom: STALE_CAUSES.has(code) ? 'none' : 'agent2' } }
    }
    const receipt = commit.receipt
    const lengths = { bodyBytes: Buffer.byteLength(tree.value.body, 'utf8'), fileBytes: tree.value.files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0), totalBytes: Buffer.byteLength(tree.value.body, 'utf8') + tree.value.files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0) }
    return {
      kind: 'merged',
      ...(receipt?.unitId === undefined ? {} : { unitId: receipt.unitId }),
      archived: receipt?.archived ?? [],
      lengths,
      validationPlan: { planVersion: validationPlan.planVersion, stageDigest: validationPlan.stageDigest, revision: validationPlan.revision, manifestFiles: validationPlan.manifestFiles },
      ...(parentRunId === undefined ? {} : { parentRunId }),
      manifestFiles: validationPlan.manifestFiles,
      validationIssues: findings,
      criteria: { decision: 'merge', validation: 'required', commit: 'required', archive: 'sources', evidence: 'receipt' },
      target: { requested: decision.target, actual: commit.plan.target, created: receipt?.create ?? false },
    }
  } finally {
    try { await options.channel.dispose(opened.childId) } catch { /* teardown must not replace the outcome */ }
    options.onChildClosed?.(opened.childId)
  }
}

/** Bind the round-2 port to one run: approve/resume open a NEW child per run. */
export function createNewChildRound2(options: Omit<NewChildAuthoringOptions, 'runId'>): (row: MergeRow, decision: MergeDecision, signal: AbortSignal, runId: string) => Promise<ScanRound2Outcome> {
  return (row, decision, signal, runId) => runNewChildAuthoring({ ...options, runId }, row, decision, signal)
}
