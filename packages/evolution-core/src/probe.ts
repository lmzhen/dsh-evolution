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
