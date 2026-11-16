/**
 * The family's Result/error vocabulary for new boundaries.
 *
 * Existing surfaces keep their structured `{ ok, message }` policy; this module
 * is the typed seam for code that wants an explicit success/failure value
 * without throwing through a domain boundary.
 */
export type FamilyErrorCode =
  | 'E-301' | 'E-302' | 'E-303' | 'E-304' | 'E-305' | 'E-306' | 'E-307' | 'E-308' | 'E-309' | 'E-310'
  | 'E-311' | 'E-312' | 'E-313' | 'E-314' | 'E-315' | 'E-316' | 'E-317' | 'E-318' | 'E-319' | 'E-320'
  | 'E-321' | 'E-322' | 'E-323' | 'E-324' | 'E-325' | 'E-326'

export interface FamilyError {
  readonly code: FamilyErrorCode
  readonly message: string
  readonly cause?: unknown
}

export type Result<T, E = FamilyError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

export function isOk<T, E>(result: Result<T, E>): result is { readonly ok: true; readonly value: T } {
  return result.ok
}

export function isErr<T, E>(result: Result<T, E>): result is { readonly ok: false; readonly error: E } {
  return !result.ok
}

/** The value, or the supplied fallback when the result is an error. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback
}

/** Coerce a caught value into the family error shape. */
export function familyError(code: FamilyErrorCode, cause: unknown): FamilyError {
  return {
    code,
    message: cause instanceof Error ? cause.message : String(cause),
    ...(cause === undefined ? {} : { cause }),
  }
}
