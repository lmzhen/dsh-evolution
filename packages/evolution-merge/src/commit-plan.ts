/**
 * Pure commit-plan assembly for a staged merge tree.
 *
 * The control plane has already chosen the target name and the child wrote merged/<target>/.
 * This module only turns those bytes into a CommitMergePlan; it never reads the live tree and
 * never decides whether a merge is allowed (validateStagedTree does that).
 */
import type { CommitMergePlan, WriteOrigin } from '@deepseek-ai/dsh-evolution-core'

const MAX_SKILL_NAME_LENGTH = 64

export type ResolveTargetResult =
  | { readonly ok: true; readonly name: string; readonly suffix: number }
  | { readonly ok: false; readonly message: string }

/** Pick the first free target: requested, then -v2, -v3, ... (never truncate a name). */
export function resolveTargetName(requested: string, exists: (name: string) => boolean): ResolveTargetResult {
  if (requested.length === 0 || requested.length > MAX_SKILL_NAME_LENGTH) {
    return { ok: false, message: 'target name must be 1..' + String(MAX_SKILL_NAME_LENGTH) + ' characters' }
  }
  if (!exists(requested)) return { ok: true, name: requested, suffix: 1 }
  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const candidate = requested + '-v' + String(suffix)
    if (candidate.length > MAX_SKILL_NAME_LENGTH) break
    if (!exists(candidate)) return { ok: true, name: candidate, suffix }
  }
  return { ok: false, message: 'no free target name for ' + requested + ' (tried up to -v99)' }
}

/** Rewrite only the frontmatter name; body bytes stay otherwise intact. */
export function rewriteFrontmatterName(body: string, name: string): string {
  const lines = body.split('\n')
  if (lines[0]?.trim() !== '---') return body
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end < 0) return body
  for (let index = 1; index < end; index += 1) {
    if (/^name\s*:/.test(lines[index] ?? '')) {
      lines[index] = 'name: ' + name
      return lines.join('\n')
    }
  }
  return body
}

export interface BuildCommitPlanInput {
  readonly target: string
  readonly create: boolean
  readonly mergedBody: string
  readonly mergedFiles: readonly { readonly path: string; readonly content: string }[]
  readonly targetCurrent: string | null
  readonly sourceBodies: readonly { readonly name: string; readonly body: string }[]
  readonly origin: WriteOrigin
  readonly summary: string
}

export type BuildCommitPlanResult =
  | { readonly ok: true; readonly plan: CommitMergePlan }
  | { readonly ok: false; readonly message: string }

export function buildCommitPlan(input: BuildCommitPlanInput): BuildCommitPlanResult {
  if (input.create !== (input.targetCurrent === null)) return { ok: false, message: 'create flag disagrees with the live target' }
  if (input.sourceBodies.length === 0) return { ok: false, message: 'a merge needs at least one source' }
  const body = rewriteFrontmatterName(input.mergedBody, input.target)
  return {
    ok: true,
    plan: {
      target: input.target,
      targetExists: !input.create,
      sources: input.sourceBodies.map(source => source.name),
      body,
      supportFiles: input.mergedFiles,
      expectedTargetBody: input.targetCurrent,
      expectedSourceBodies: input.sourceBodies,
      origin: input.origin,
      summary: input.summary,
    },
  }
}
