/**
 * Skill write observation: the domain-level counterpart of platform
 * `fs-observation-policy`.
 *
 * A successful read records `present(version)` or `absent` for one owner
 * (session / review task / run identity) and one target. Writes later derive
 * their expected version from this store; observations never cross owners.
 *
 * This module is intentionally dependency-free and has no enforcement: Phase A
 * only collects observations. The SkillWriteService switches writes onto them
 * in a later phase, so existing behavior cannot change from this file alone.
 *
 * @module @deepseek-ai/dsh-evolution-core/skill-observation
 */
import { contentHash } from './mutations.ts'

/** The skill content version used by all observations and write intents. */
/**
 * The freshness token an observation carries.
 *
 * The source decides its basis: the platform `fs` edge uses its opaque
 * `FsVersion`, while a path that has the full canonical bytes may use a
 * content version. The store never reinterprets the token, so the same
 * observation cannot silently change meaning between read and write.
 */
export type SkillObservedVersion = string

/** The content identity used by semantic anchors (staged snapshots, history). */
export type SkillContentVersion = string

/**
 * One skill file a write can target.
 *
 * `relPath` is empty for `SKILL.md` and a normalized support-file path
 * otherwise. `targetKey` is the canonical identity used by the observation
 * store and later by per-target locks, so two spellings of the same path
 * cannot observe one file and write another.
 */
export interface SkillTarget {
  readonly skill: string
  readonly relPath: string
  readonly targetKey: string
}

/** One authoritative read observation. */
export type SkillObservation =
  | { readonly kind: 'present'; readonly version: SkillObservedVersion }
  | { readonly kind: 'absent' }

/** Any object with stable identity: a session, a review task, a run handle. */
export type SkillObservationOwner = object

/** Why a target observation is unavailable. */
export type SkillObservationRefusal =
  | { readonly kind: 'unobserved' }
  | { readonly kind: 'absent' }

/**
 * Canonical target key. Skill names are trimmed; support paths are slash
 * normalized and collapsed. The key is never a filesystem path, so it cannot
 * leak a host-specific separator into persistence or diagnostics.
 * @param skill - raw skill name supplied by a caller.
 * @param relPath - empty for SKILL.md, otherwise the support-file path.
 * @returns the normalized target.
 */
export function skillTarget(skill: string, relPath = ''): SkillTarget {
  const name = skill.trim()
  if (name === '') throw new Error('skillTarget requires a skill name')
  const rel = normalizeRelPath(relPath)
  const targetKey = name + '::' + rel
  return { skill: name, relPath: rel, targetKey }
}

/** The namespace lock key covering every file of one skill. */
export function skillNamespaceKey(skill: string): string {
  const name = skill.trim()
  if (name === '') throw new Error('skillNamespaceKey requires a skill name')
  return 'skill::' + name + '::*'
}

/** The SKILL.md target of one skill. */
export function skillBodyTarget(skill: string): SkillTarget {
  return skillTarget(skill, '')
}

/** One support-file target of one skill. */
export function skillSupportTarget(skill: string, relPath: string): SkillTarget {
  if (normalizeRelPath(relPath) === '') {
    throw new Error('skillSupportTarget requires a non-empty support path')
  }
  return skillTarget(skill, relPath)
}

/** Derive the version a write must observe for these current bytes. */
export function skillVersionOf(content: string): SkillContentVersion {
  return contentHash(content)
}

/** Normalize a support path to forward slashes, without leading/trailing ones. */
function normalizeRelPath(relPath: string): string {
  const slashed = relPath.replaceAll('\\', '/')
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) {
    throw new Error('skill support paths must be relative')
  }
  const parts = slashed.split('/')
  if (parts.includes('..')) throw new Error('skill support paths must not contain ".."')
  return parts.filter(part => part !== '' && part !== '.').join('/')
}

/**
 * Per-owner observation state. A WeakMap owner key keeps a collected session or
 * review task from retaining its reads; disposal blocks HMR from carrying stale
 * observations into a new implementation generation.
 */
export class SkillObservationStore {
  private byOwner = new WeakMap<SkillObservationOwner, Map<string, SkillObservation>>()

  /**
   * Record one successful read observation.
   * @param owner - exact reading identity; never a shared global.
   * @param target - the read target.
   * @param observation - `present` with the read version, or `absent`.
   */
  record(owner: SkillObservationOwner, target: SkillTarget, observation: SkillObservation): void {
    let reads = this.byOwner.get(owner)
    if (reads === undefined) {
      reads = new Map()
      this.byOwner.set(owner, reads)
    }
    reads.set(target.targetKey, observation)
  }

  /**
   * Read the newest observation for one owner/target.
   * @returns the observation, or `undefined` when this owner never read it.
   */
  get(owner: SkillObservationOwner, target: SkillTarget): SkillObservation | undefined {
    return this.byOwner.get(owner)?.get(target.targetKey)
  }

  /**
   * Resolve the observation a writer may rely on.
   * @returns the present version, or the refusal that names why it is unusable.
   */
  requirePresent(owner: SkillObservationOwner, target: SkillTarget): { readonly version: SkillObservedVersion } | SkillObservationRefusal {
    const observation = this.get(owner, target)
    if (observation === undefined) return { kind: 'unobserved' }
    if (observation.kind === 'absent') return { kind: 'absent' }
    return { version: observation.version }
  }

  /** Drop every observation, e.g. on plugin disposal or HMR. */
  clear(): void {
    this.byOwner = new WeakMap()
  }
}
