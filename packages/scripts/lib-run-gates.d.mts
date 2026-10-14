/**
 * Type declarations for lib-run-gates.mjs.
 *
 * The module is plain JavaScript on purpose (the installer consumes it too), but the family specs
 * import it from TypeScript. Without a declaration every imported value is an `error` type there,
 * which is what the lint no-unsafe family reports; this file is the standard resolution path for a
 * .mjs sibling and keeps the runtime bytes untouched.
 */

export interface GateDecision {
  verdict: string
  criterionEvaluated: boolean
  cause?: { kind: string }
  evidence?: string
  next?: string
  missing?: string[]
}

export interface RunOutcome {
  argv: string[]
  cwd: string | null
  status: number | null
  killedBy: 'budget' | 'external' | null
  budgetMs?: number
  signal?: string | null
  errorCode?: string
  ms?: number
  present?: boolean
}

export declare const KINDS: readonly string[]
export declare const MODES: readonly string[]
export declare const LEGAL_COMBINATIONS: readonly string[]
export declare const ERRNO_CLASS: Record<string, string>

export declare function classifyErrno(code: string): 'missing' | 'denied' | 'timeout' | 'unknown' | null
export declare function isLegalCombination(kind: string, mode: string): boolean
export declare function decideRequires(result: unknown, kind: string, mode: string): GateDecision
export declare function createRunner(deps: { spawn: Function; now: () => number }): { run: Function }
