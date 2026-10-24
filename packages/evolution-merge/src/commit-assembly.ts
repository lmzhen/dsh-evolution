/**
 * Turn a fully written staging tree into a CommitMergePlan.
 *
 * Source bodies come from the LIVE tree (the plan's CAS baseline), the target body from
 * the merged tree. This function is pure except for the injected reads; it never commits.
 */
import type { CommitMergePlan, WriteOrigin } from '@deepseek-ai/dsh-evolution-core'
import { isPresent } from '@deepseek-ai/dsh-evolution-core'
import { readStaging } from './staging.ts'
import { readStagedTree } from './staged-tree.ts'
import { buildCommitPlan } from './commit-plan.ts'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'

export interface CommitAssemblyPort {
  /** Current SKILL.md body, or null when the skill is not live. */
  readSkill(name: string): Promise<string | null>
  /** Whether the name is already occupied by an archived (tombstoned) skill. */
  isArchived?(name: string): Promise<boolean>
  /** Whether a directory exists for the name (including a SKILL.md-less ghost). */
  isNameOccupied?(name: string): Promise<boolean>
}

export interface CommitAssemblyOptions {
  readonly origin: WriteOrigin
  readonly summary: string
}

export type CommitAssemblyResult =
  | { readonly ok: true; readonly plan: CommitMergePlan }
  | { readonly ok: false; readonly message: string }

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
  let target = requested
  let targetCurrent = await port.readSkill(requested)
  if (staging.value.manifest.mode !== 'create-umbrella' && targetCurrent === null) {
    return { ok: false, message: 'target is gone; refusing to re-create it: ' + requested }
  }
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
  const sources: { name: string; body: string }[] = []
  for (const name of staging.value.manifest.sources) {
    const body = await port.readSkill(name)
    if (body === null) return { ok: false, message: 'source skill is not live: ' + name }
    sources.push({ name, body })
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
  })
}
