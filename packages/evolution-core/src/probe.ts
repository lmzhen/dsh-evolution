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
 * Three-state TEXT read of one file. A missing path (ENOENT/ENOTDIR, or a backend whose read
 * answers null) is `absent`; every other failure is `unknown` with its reason. The distinction is
 * the whole point (N14/O-7): "I could not read this file" and "this file is not there" lead to
 * opposite decisions once a write is about to replace the bytes — treating the first as the
 * second is how a broken store reads as empty and a rescue copy never happens.
 * @param io - the IO seam.
 * @param path - the file to read.
 * @returns the probe.
 */
export async function probeText(io: EvolutionIoLike, path: string): Promise<Probe<string>> {
  try {
    const value = await io.readText(path)
    return value === null ? probeAbsent() : probePresent(value)
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

/** The timestamp a curator run report DECLARES: `startedAt` (the run's own start), then `at` (the
 * stamp the error writer sets on every report — F-327/P2-4).
 * @param parsed - the parsed report, or anything else.
 * @returns epoch milliseconds, or null when neither field carries a parseable time.
 */
export function declaredReportStamp(parsed: unknown): number | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as { startedAt?: unknown; at?: unknown }
  for (const value of [record.startedAt, record.at]) {
    if (typeof value !== 'string') continue
    const ms = Date.parse(value)
    if (Number.isFinite(ms)) return ms
  }
  return null
}

/** The time one curator run report is ordered by — ONE口径 for every reader (S2.9/T3-12): the
 * declared stamp above, then the optional mtime probe as the fallback. `null` means "no usable
 * time", and that single answer serves both consumers: such a report is never the LATEST (the
 * panel) and is never DELETED (the retention sweep), which is exactly the pair of answers the two
 * readers disagreed on when one ordered by the declared stamp and the other by mtime alone.
 * @param io - the IO seam; a backend without `mtime` simply has no fallback.
 * @param path - the report file the probe reads.
 * @param parsed - the already-parsed report.
 * @returns epoch milliseconds, or null.
 */
export async function reportTime(io: EvolutionIoLike, path: string, parsed: unknown): Promise<number | null> {
  const declared = declaredReportStamp(parsed)
  if (declared !== null) return declared
  const probe = await probeMtime(io, path)
  return isPresent(probe) ? probe.value : null
}
