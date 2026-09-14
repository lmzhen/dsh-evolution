/**
 * V41 phase-1 follow-up: the read THREE-state (P2-25 sibling of N14).
 *
 * A read has three outcomes, not two: the value is there, it is genuinely not
 * there, or we could not decide (IO error, unreadable store, missing
 * provider). Collapsing the third into either of the others is how a broken
 * store reads as "empty" and a guard silently passes — the class N14 registers.
 * Migration target for the pre-existing two-state patches (protectionUnknown /
 * unverifiable): constructors are prefixed so the type can never be confused
 * with a value, and only `present` yields a value.
 */
import type { EvolutionIoLike } from './io.ts'

export type Probe<T> =
  | { kind: 'present'; value: T }
  | { kind: 'absent' }
  | { kind: 'unknown'; reason: string }

export function probePresent<T>(value: T): Probe<T> {
  return { kind: 'present', value }
}

export function probeAbsent<T>(): Probe<T> {
  return { kind: 'absent' }
}

export function probeUnknown<T>(reason: string): Probe<T> {
  return { kind: 'unknown', reason }
}

export function isPresent<T>(probe: Probe<T>): probe is { kind: 'present'; value: T } {
  return probe.kind === 'present'
}

export function isAbsent<T>(probe: Probe<T>): probe is { kind: 'absent' } {
  return probe.kind === 'absent'
}

export function isUnknown<T>(probe: Probe<T>): probe is { kind: 'unknown'; reason: string } {
  return probe.kind === 'unknown'
}

/** Only a PRESENT probe yields a value; absent and unknown both fall back. */
export function valueOr<T>(probe: Probe<T>, fallback: T): T {
  return probe.kind === 'present' ? probe.value : fallback
}

export function mapProbe<T, U>(probe: Probe<T>, transform: (value: T) => U): Probe<U> {
  return probe.kind === 'present' ? probePresent(transform(probe.value)) : probe
}

/** The reason an `unknown` probe carries (message, never a bare String(object)). */
export function probeReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * ENOENT/ENOTDIR are the ONE read failure that means "it is not there"; every
 * other failure is an IO error and stays unknown (same split as the node
 * backend's own isMissing, V8-23⑨ for the size probe).
 */
export function isMissingPath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * Three-state directory listing. The node backend already answers `[]` for a
 * MISSING directory (its own rc.50 P2-4 contract) and THROWS for an unreadable
 * one, so the value this adds is the second half: a backend that throws ENOENT
 * reads as absent, an EACCES/EIO reads as unknown — where a bare
 * `catch { return [] }` served a broken store as an empty one (the N14 class).
 */
export async function probeList(io: EvolutionIoLike, dir: string): Promise<Probe<string[]>> {
  try {
    return probePresent(await io.list(dir))
  } catch (error) {
    return isMissingPath(error) ? probeAbsent() : probeUnknown(probeReason(error))
  }
}

/**
 * Three-state mtime read. Absent covers both "the path is missing" and "this
 * backend has no mtime probe" — the seam cannot tell those apart, so consumers
 * that must know say so in their own log line. A stat that FAILS is unknown.
 */
export async function probeMtime(io: EvolutionIoLike, path: string): Promise<Probe<number>> {
  try {
    const value = (await io.mtime?.(path)) ?? null
    return value === null ? probeAbsent() : probePresent(value)
  } catch (error) {
    return probeUnknown(probeReason(error))
  }
}
