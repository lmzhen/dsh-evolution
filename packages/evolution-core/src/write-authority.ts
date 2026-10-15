/**
 * G1/1.1: the ONE authority behind a write.
 *
 * Before this type existed the inputs of the can-I-write decision came from two places with two
 * lifecycles: `origin` (plus the policy snapshot and the confirm seam) travelled in the tool
 * package gate context, while `threatExemptLabels` rode the SkillLibrary constructor. Callers that
 * reached the bytes through another path built neither, and the mutators defaulted `origin` to
 * foreground - so an omitted authority silently read as the operator acting, and no mechanism said
 * otherwise (measured: two entry points in the same curator file, one passing background_review and
 * one defaulting).
 *
 * The shape below is where those inputs converge. The follow-up batch makes it a REQUIRED argument
 * of every mutator (content and lifecycle alike) and deletes the defaults, so an omission is a
 * compile error instead of a silent claim about who wrote the bytes.
 */
import type { WriteOrigin } from './skill-store.ts'

/**
 * The confirmation contract, HOISTED here from tool-skill-manage (G1/1.1 follow-up): the authority
 * carries the confirm seam, so the seam's vocabulary lives with it. tool-skill-manage re-exports
 * these names from write-gates.ts unchanged, so nothing importing them from there moves.
 */
export type WriteConfirmMode = 'auto' | 'ask' | 'timeout'

/** The mode a deployment that configures nothing gets. */
export const DEFAULT_WRITE_CONFIRM_MODE: WriteConfirmMode = 'auto'

/** Seconds a timeout-mode prompt waits before the write is cancelled. */
export const DEFAULT_WRITE_CONFIRM_TIMEOUT_SECONDS = 120

/** What the operator is told about the target before answering. */
export interface ConfirmContext {
  readonly description?: string | undefined
  readonly versions?: number | undefined
}

/** One confirm question, as the gate writes it and the seam asks it. */
export interface WriteConfirmRequest {
  readonly action: string
  readonly name: string
  readonly question: {
    readonly id: string
    readonly header: string
    readonly question: string
    readonly options: readonly { readonly label: string }[]
  }
  readonly confirmLabel: string
  readonly signal?: AbortSignal
}

/** Ask the human to confirm one irreversible skill write. MUST be total: every unavailability
 * resolves to true, so no failure of the question service blocks the operator's own write. */
export type WriteConfirm = (request: WriteConfirmRequest) => Promise<boolean>

/**
 * The batch-one migration aid: every call site becomes ONE of these instead of hand-building the
 * object - so the shape cannot drift between callers, and each site still has to say its own
 * origin out loud (origin is required here on purpose: the whole point is that no caller inherits
 * a default identity).
 */
export function authorityFrom(input: {
  origin: WriteOrigin
  threatExemptLabels?: readonly string[]
  protectedNames?: readonly string[] | undefined
  readNames?: ReadonlySet<string> | undefined
  confirm?: WriteConfirm
  confirmMode?: WriteConfirmMode
  confirmTimeoutSeconds?: number
  /** Optional: a call site that has nothing to report may leave it out, and the gates then stay
   * silent instead of forcing every one of the twelve construction points to invent a logger. */
  warn?: (message: string) => void
}): WriteAuthority {
  return {
    origin: input.origin,
    threatExemptLabels: input.threatExemptLabels ?? [],
    protectedNames: input.protectedNames,
    readNames: input.readNames,
    ...input.confirm === undefined ? {} : { confirm: input.confirm },
    ...input.confirmMode === undefined ? {} : { confirmMode: input.confirmMode },
    ...input.confirmTimeoutSeconds === undefined ? {} : { confirmTimeoutSeconds: input.confirmTimeoutSeconds },
    warn: input.warn ?? (() => {}),
  }
}

export interface WriteAuthority {
  /** Who is asking: the operator own session, a background review, the curator, the graph face. */
  readonly origin: WriteOrigin
  /** Labels the threat scan must not refuse (P2-18). Migrated here from the library constructor:
   * one decision must not read its policy from two objects. */
  readonly threatExemptLabels: readonly string[]
  /** The policy snapshot protected list; undefined when no policy row is mounted. */
  readonly protectedNames: readonly string[] | undefined
  /** Names this session read successfully; undefined when the session log is not readable. */
  readonly readNames: ReadonlySet<string> | undefined
  /** The human confirm seam, read only where a question is actually asked. */
  readonly confirm?: WriteConfirm
  /** skillWriteConfirm: auto (the default) skips the question entirely. */
  readonly confirmMode?: WriteConfirmMode
  /** skillWriteConfirmTimeoutSeconds, read only in timeout mode. */
  readonly confirmTimeoutSeconds?: number
  /** Report a degraded gate; must not throw. */
  readonly warn: (message: string) => void
}
