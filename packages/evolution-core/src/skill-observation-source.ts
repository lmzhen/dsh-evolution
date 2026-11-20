/**
 * Map framework filesystem observations onto skill targets.
 *
 * The platform emits `fs/observed(target, observation, actor)` after a
 * successful read. This module is the skill-domain edge: it decides whether a
 * host path names SKILL.md or a support file under one skill, and records the
 * platform's opaque version in a {@link SkillObservationStore}.
 *
 * It deliberately does not decide which version model wins (platform FsVersion
 * vs content sha256); that choice belongs to the SkillWriteService phase. Its
 * only job is path-to-target identity, so an observation and a later write
 * cannot disagree about which skill file they mean.
 *
 * @module @deepseek-ai/dsh-evolution-core/skill-observation-source
 */
import { relative, resolve, isAbsolute } from 'node:path'
import type { SkillObservationStore, SkillTarget } from './skill-observation.ts'
import { skillBodyTarget, skillSupportTarget } from './skill-observation.ts'

/** One platform observation, already reduced to the values the store needs. */
export interface FsSkillObservation {
  /** Absolute host path of the read target. */
  readonly hostPath: string
  /** Platform `FsVersion` or another opaque freshness token. */
  readonly version: string
}

/**
 * Resolve a host path under the skills root to one skill file.
 * @param root - absolute skills root.
 * @param hostPath - absolute path reported by the platform observation.
 * @returns the target, or `undefined` when the path is outside the root, points
 * at the root itself, or is not a skill file (`SKILL.md` / a support file).
 */
export function skillTargetFromHostPath(root: string, hostPath: string): SkillTarget | undefined {
  if (!isAbsolute(root) || !isAbsolute(hostPath)) return undefined
  const rel = relative(resolve(root), resolve(hostPath)).replaceAll('\\', '/')
  if (rel === '' || rel.startsWith('../') || rel === '..' || isAbsolute(rel)) return undefined
  const parts = rel.split('/').filter(part => part !== '' && part !== '.')
  if (parts.length < 2) return undefined
  const [skill, ...rest] = parts
  if (skill === undefined || skill === '') return undefined
  if (rest.length === 1 && rest[0] === 'SKILL.md') return skillBodyTarget(skill)
  return skillSupportTarget(skill, rest.join('/'))
}

/**
 * Record one platform observation when it names a skill file.
 * @param store - the per-context observation store.
 * @param owner - exact reading identity (session / review task / run object).
 * @param root - absolute skills root.
 * @param observation - host path and opaque version from the platform event.
 * @returns the recorded target, or `undefined` when the path is not a skill file.
 */
export function recordFsSkillObservation(
  store: SkillObservationStore,
  owner: object,
  root: string,
  observation: FsSkillObservation,
): SkillTarget | undefined {
  const target = skillTargetFromHostPath(root, observation.hostPath)
  if (target === undefined) return undefined
  store.record(owner, target, { kind: 'present', version: observation.version })
  return target
}
