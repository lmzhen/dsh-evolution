/**
 * Turn a fully written staging tree into a CommitMergePlan.
 *
 * Source bodies come from the LIVE tree (the plan's CAS baseline), the target body from
 * the merged tree. This function is pure except for the injected reads; it never commits.
 * It also re-checks the round-1 decision anchors against the live tree BEFORE the commit
 * port is called, so a source/target change is refused with a typed cause rather than a
 * generic commit message.
 */
import type { CommitMergePlan, WriteOrigin, SkillLimits } from '@deepseek-ai/dsh-evolution-core'
import { isPresent, revisionAnchorOf, revisionFingerprint, revisionSupportDigest, type RevisionAnchor, type RevisionFile } from '@deepseek-ai/dsh-evolution-core'
import { readStaging } from './staging.ts'
import { readStagedTree } from './staged-tree.ts'
import { buildCommitPlan } from './commit-plan.ts'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { RevisionRef } from './contracts.ts'

export interface CommitAssemblyPort {
  /** Current SKILL.md body, or null when the skill is not live. */
  readSkill(name: string): Promise<string | null>
  /** Every support file of a live skill; absent means the port cannot enumerate them. */
  readSupportFiles?(name: string): Promise<readonly RevisionFile[]>
  /** Whether the name is already occupied by an archived (tombstoned) skill. */
  isArchived?(name: string): Promise<boolean>
  /** Whether a directory exists for the name (including a SKILL.md-less ghost). */
  isNameOccupied?(name: string): Promise<boolean>
}

export interface CommitAssemblyOptions {
  readonly origin: WriteOrigin
  readonly summary: string
  readonly limits?: SkillLimits
  /** Round-1 decision anchors re-checked here (the store repeats the check under its lock). */
  readonly targetRevision?: RevisionRef
  readonly sourceRevisions?: Readonly<Record<string, RevisionRef>>
  readonly supportDigest?: string
}

export type CommitAssemblyResult =
  | { readonly ok: true; readonly plan: CommitMergePlan }
  | { readonly ok: false; readonly code?: 'target-changed' | 'source-changed' | 'support-changed'; readonly message: string }

type LiveRevision =
  | { readonly verified: false }
  | { readonly verified: true; readonly anchor: RevisionAnchor; readonly fingerprint: string | null }

function sameAnchor(expected: RevisionRef, live: RevisionAnchor): boolean {
  if (expected.kind === 'absent') return live.kind === 'absent'
  return live.kind === 'present' && expected.sha256 === live.sha256
}

async function liveRevision(port: CommitAssemblyPort, name: string, body: string | null): Promise<LiveRevision> {
  if (port.readSupportFiles === undefined) return { verified: false }
  let files: readonly RevisionFile[]
  try {
    files = body === null ? [] : await port.readSupportFiles(name)
  } catch {
    return { verified: false }
  }
  return { verified: true, anchor: revisionAnchorOf(name, body, files), fingerprint: body === null ? null : revisionFingerprint(name, body, files) }
}

/** Why the staging tree no longer matches the decision, or null when it still does. */
async function decisionRevisionFailure(
  port: CommitAssemblyPort,
  requested: string,
  targetCurrent: string | null,
  sources: readonly { readonly name: string; readonly body: string }[],
  options: CommitAssemblyOptions,
): Promise<{ readonly code: 'target-changed' | 'source-changed' | 'support-changed'; readonly message: string } | null> {
  if (options.targetRevision === undefined && options.sourceRevisions === undefined && options.supportDigest === undefined) return null
  const target = await liveRevision(port, requested, targetCurrent)
  if (!target.verified) return null
  if (options.targetRevision !== undefined && !sameAnchor(options.targetRevision, target.anchor)) {
    return { code: 'target-changed', message: '目标技能「' + requested + '」的内容在决策之后被改过；拒绝提交（未写入任何内容）。' }
  }
  const fingerprints: string[] = target.fingerprint === null ? [] : [target.fingerprint]
  for (const source of sources) {
    // The staging manifest lists the target among its sources; the digest is over the
    // participating skills (target + absorbed sources), so the target appears once.
    if (source.name === requested) continue
    const live = await liveRevision(port, source.name, source.body)
    if (!live.verified) continue
    const expected = options.sourceRevisions?.[source.name]
    if (expected !== undefined && !sameAnchor(expected, live.anchor)) {
      return { code: 'source-changed', message: '来源技能「' + source.name + '」的内容在决策之后被改过；拒绝提交（未写入任何内容）。' }
    }
    if (live.fingerprint !== null) fingerprints.push(live.fingerprint)
  }
  if (options.supportDigest !== undefined && revisionSupportDigest(fingerprints) !== options.supportDigest) {
    return { code: 'support-changed', message: '参与合并的技能支撑文件在决策之后被改过；拒绝提交（未写入任何内容）。' }
  }
  return null
}

export async function assembleStagedCommit(
  io: EvolutionIoLike,
  home: string,
  runId: string,
  port: CommitAssemblyPort,
  options: CommitAssemblyOptions,
): Promise<CommitAssemblyResult> {
  const staging = await readStaging(io, home, runId)
  if (!isPresent(staging)) return { ok: false, message: 'staging is not present for run ' + runId }
  const tree = await readStagedTree(io, home, runId)
  if (!isPresent(tree)) return { ok: false, message: 'merged tree is not readable for run ' + runId }
  const requested = staging.value.manifest.target
  const requestedCurrent = await port.readSkill(requested)
  let target = requested
  let targetCurrent = requestedCurrent
  if (staging.value.manifest.mode !== 'create-umbrella' && targetCurrent === null) {
    return { ok: false, message: 'target is gone; refusing to re-create it: ' + requested }
  }
  const sources: { name: string; body: string }[] = []
  for (const name of staging.value.manifest.sources) {
    const body = await port.readSkill(name)
    if (body === null) return { ok: false, message: 'source skill is not live: ' + name }
    sources.push({ name, body })
  }
  const revisionFailure = await decisionRevisionFailure(port, requested, requestedCurrent, sources, options)
  if (revisionFailure !== null) return { ok: false, code: revisionFailure.code, message: revisionFailure.message }
  const requestedArchived = targetCurrent === null && await port.isArchived?.(requested) === true
  const requestedOccupied = targetCurrent === null && await port.isNameOccupied?.(requested) === true
  if (staging.value.manifest.mode === 'create-umbrella' && (targetCurrent !== null || requestedArchived || requestedOccupied)) {
    target = requested
    for (let suffix = 2; suffix <= 99; suffix += 1) {
      const candidate = requested + '-v' + String(suffix)
      if (await port.readSkill(candidate) === null
        && await port.isArchived?.(candidate) !== true
        && await port.isNameOccupied?.(candidate) !== true) {
        target = candidate
        targetCurrent = null
        break
      }
    }
    if (target === requested) return { ok: false, message: 'no free umbrella target for ' + requested }
  }
  return buildCommitPlan({
    target,
    create: targetCurrent === null,
    mergedBody: tree.value.body,
    mergedFiles: tree.value.files,
    targetCurrent,
    sourceBodies: sources,
    origin: options.origin,
    summary: options.summary,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.targetRevision === undefined ? {} : { targetRevision: options.targetRevision }),
    ...(options.sourceRevisions === undefined ? {} : { sourceRevisions: options.sourceRevisions }),
    ...(options.supportDigest === undefined ? {} : { supportDigest: options.supportDigest }),
  })
}
