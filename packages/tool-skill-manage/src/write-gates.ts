/**
 * The write-admission sequence: ONE ordered table of the reasons a skill write is refused.
 *
 * Two points read this table (design `dsh-evolution-write-gate-design.md` §3). The ADMISSION
 * point (`execute`, BEFORE the approval seam) runs every gate that applies to `'admission'`, so a
 * write that is refused is never staged and never spends the operator's attention twice. The
 * EXECUTION point (the `executeCore` funnel, reached by the direct path and by the approval
 * replay) runs the gates that apply to `'execution'`: the stored plan of a replayed write passed
 * no schema, and the protected list can change while a record sits pending, so those verdicts are
 * re-decided at the bytes.
 *
 * Order is part of the contract: a gate that can only refuse comes before one that needs a round
 * trip with the operator, so a write that is refused anyway never asks anything.
 *
 * A gate decides whether a write may be ATTEMPTED. The library decides whether it can be
 * PERFORMED — its own structured refusals (a restructure element that is not an object, a patch
 * anchor that no longer matches, an `absorbed_into` that does not exist) stay where the bytes are
 * read.
 *
 * Rule bodies live in `evolution-core` (the read-before-write rule in `skill-reads`, the
 * required-argument table in `SKILL_ACTION_REQUIRED_FIELDS`); this module owns the ORDER and the
 * applicability of each gate, which is an execution-point fact of this tool.
 * @module @deepseek-ai/dsh-tool-skill-manage/write-gates
 */
import { SKILL_ACTION_REQUIRED_FIELDS, errorText, isUnreadWrite, type WriteOrigin } from '@deepseek-ai/dsh-evolution-core'

/** The point whose verdict is being taken. */
export type WriteGatePoint = 'admission' | 'execution'

/** The confirm question's stable id — one question per write, so an answer to an earlier prompt
 * can never be read as the answer to a later one. */
const CONFIRM_QUESTION_ID = 'evolution-skill-write'

/** The cancel label every confirm question offers. */
const CANCEL_LABEL = 'Cancel'

/** One confirm question, as the gate writes it and the seam asks it. */
export interface WriteConfirmRequest {
  /** The action being confirmed (`create` or `delete`). */
  readonly action: string
  /** The skill the write would create or archive. */
  readonly name: string
  /** The question for the operator: the options are the confirm label, then the cancel label. */
  readonly question: {
    readonly id: string
    readonly header: string
    readonly question: string
    readonly options: readonly { readonly label: string }[]
  }
  /** The option label that means "proceed". */
  readonly confirmLabel: string
}

/**
 * Ask the human to confirm one irreversible skill write.
 *
 * MUST be total: an implementation resolves every unavailability — no question service, no live root
 * agent, a failing ask — to `true`, because this gate is an operator convenience and no failure of the
 * question service may block the operator's own write. `false` means the human answered something
 * other than the confirm label.
 * @param request - the question to put to the operator and the label that means "proceed".
 * @returns true to proceed with the write.
 */
export type WriteConfirm = (request: WriteConfirmRequest) => Promise<boolean>

/** The scalar fields the tool schema types as strings; the replay channel has no schema.
 * `action` is one of them: a non-string action used to fall through to the library as "Unknown
 * action" while the read gate re-defaulted it to `patch` and refused with E-318 (review
 * 2026-09-26, P2), so the shape gate refuses it by name instead. */
const SCALAR_ARG_FIELDS = ['action', 'name', 'content', 'old_string', 'new_string', 'file_path', 'file_content', 'absorbed_into'] as const

/** What every gate reads. */
export interface WriteGateContext {
  /** The point asking: the tool's admission of a call, or its execution at the bytes. */
  readonly point: WriteGatePoint
  /** The parsed (admission) or stored (replay) arguments — unvalidated, hence the shape gate. */
  readonly args: unknown
  /** The library write origin: `foreground` is the operator's own session. */
  readonly origin: WriteOrigin
  /** The policy snapshot's protected list; `undefined` when no policy row is mounted. */
  readonly protectedNames: readonly string[] | undefined
  /** Names this session read successfully; `undefined` when the session log is not readable. */
  readonly readNames: ReadonlySet<string> | undefined
  /** The human confirm seam — read only by the gates that apply to `'admission'`. */
  readonly confirm: WriteConfirm | undefined
  /** Report a degraded gate; must not throw. The implementation decides how often it speaks — the
   * shipped seam latches once per PROCESS, because the conditions it reports (no question service,
   * an unreadable session log) belong to the deployment, not to one write. */
  readonly warn: (message: string) => void
}

/** The arguments a gate reads, with the string-valued ones narrowed once by the runner. */
interface GateArgs {
  /** The action as the caller sent it (`undefined` when absent or not a string). */
  readonly action: string | undefined
  /** The skill name, or `''` when the caller sent none. */
  readonly name: string
  /** `delete` with this set is a merge into an umbrella, not a bare archive. */
  readonly absorbedInto: string | undefined
  /** The raw arguments object, for the scalar shape gate. */
  readonly scalars: Record<string, unknown>
}

/** What a gate runs against: the caller's context plus the arguments narrowed once. */
interface WriteGateInput extends WriteGateContext {
  readonly view: GateArgs
}

interface WriteGate {
  readonly id: string
  /** The points whose verdicts this gate can change; every other point skips it. */
  readonly appliesTo: readonly WriteGatePoint[]
  /** @returns the refusal message, or null to let the write continue. */
  run(input: WriteGateInput): Promise<string | null> | string | null
}

/**
 * Narrow the arguments once for every gate.
 *
 * The admission point reaches the gates AFTER the schema, the replay channel BEFORE any
 * validation, so a gate reads only what it can prove: anything else counts as absent, exactly as
 * the missing-argument check already treated a non-string action.
 * @param args - the arguments as the caller sent them.
 * @returns the narrowed view.
 */
function gateArgsOf(args: unknown): GateArgs {
  const scalars = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
  const action = scalars.action
  const name = scalars.name
  const absorbedInto = scalars.absorbed_into
  return {
    action: typeof action === 'string' ? action : undefined,
    name: typeof name === 'string' ? name : '',
    // A BLANK absorbed_into is absent: the plan validator reads it the same way
    // (`!(op.absorbed_into ?? '').trim()`), and the archive call itself is truthiness-based
    // (`args.absorbed_into ? { absorbedInto } : {}`) — so `''` performs a BARE archive and must not
    // borrow the merge exemption (review 2026-09-26, P1).
    absorbedInto: typeof absorbedInto === 'string' && absorbedInto.trim() !== '' ? absorbedInto : undefined,
    scalars,
  }
}

/**
 * The scalar arguments must be strings before any other gate reads them as names.
 *
 * v20 (D-1, V8-09 sibling): the schema does not strictly guarantee scalar shapes (the F-07 class
 * of garbage that slipped past it), and a non-string scalar used to escape as a bare TypeError
 * from SkillLibrary (`name.trim()` / `md.includes(...)`). Family posture: a STRUCTURED refusal.
 * Absent is legal — the branches that need a value have their own remedies.
 */
const ARGUMENT_SHAPE: WriteGate = {
  id: 'argument-shape',
  appliesTo: ['admission', 'execution'],
  run: ({ view }) => {
    for (const field of SCALAR_ARG_FIELDS) {
      const value = view.scalars[field]
      if (value === undefined || value === null || typeof value === 'string') continue
      return `skill_manage: "${field}" must be a string (got ${typeof value}); refusing the write.`
    }
    return null
  },
}

/**
 * V27 G5.1 (v27 T-2) / OPT-05 (2026-09): name the missing per-action arguments before anything is
 * read or written. The table comes from core (the plan validator reads the same rows), and the
 * OWN-property narrowing is required because a plain-object index resolves inherited members
 * (`constructor`, `toString`, …) to truthy functions. An EMPTY string is deliberately NOT
 * missing: it reaches the library, whose branch messages carry the more specific remedy.
 */
const MISSING_ARGS: WriteGate = {
  id: 'missing-args',
  appliesTo: ['admission', 'execution'],
  run: ({ view }) => {
    const action = view.action
    const required = action === undefined || !Object.hasOwn(SKILL_ACTION_REQUIRED_FIELDS, action)
      ? []
      : SKILL_ACTION_REQUIRED_FIELDS[action] ?? []
    const missing = required.filter(field => view.scalars[field] === undefined || view.scalars[field] === null)
    if (missing.length === 0) return null
    return `skill_manage ${action} requires ${missing.join(', ')}; the tool description lists the arguments per action.`
  },
}

/**
 * v30 REV-02: the immutable policy's protected list is enforced at plan validation, but the
 * replay channel executes STORED plans — one accepted under an older policy must not land on a
 * skill the CURRENT policy protects. Foreground (operator) writes are deliberately not gated by
 * this list, and a deployment without the policy row keeps the previous behavior.
 */
const POLICY_PROTECTION: WriteGate = {
  id: 'policy-protection',
  appliesTo: ['admission', 'execution'],
  run: ({ view, origin, protectedNames }) => {
    if (origin === 'foreground') return null
    if (view.name === '' || !protectedNames?.includes(view.name)) return null
    return `skill_manage: "${view.name}" is protected by the current policy (protectedSkillNames); replayed/autonomous writes are refused.`
  },
}

/**
 * Read-before-write (design §4.2): a non-foreground write must have read its target in the
 * session that authored it, so a subagent or the review's own model cannot blind-overwrite a body
 * it never saw. The read set comes from `collectReadSkillNames`, which counts only a read that did
 * not fail — a failed or timed-out read does not pass this gate.
 *
 * Admission only. The reads belong to the WRITING session, and the replayed record has none: it
 * passed this gate at its own staging point, or the review's plan filter on the plan path.
 *
 * An unreadable session log is NOT an empty read set: the write proceeds with one warning, the
 * same soft-probe posture as the cross-source check, because a deployment whose sessions expose no
 * log must not refuse every autonomous write.
 */
const READ_BEFORE_WRITE: WriteGate = {
  id: 'read-before-write',
  appliesTo: ['admission'],
  run: ({ view, origin, readNames, warn }) => {
    if (origin === 'foreground') return null
    if (readNames === undefined) {
      warn('skill_manage: the read-before-write check could not run for this call — the session log is not readable here, so the write is allowed.')
      return null
    }
    // A missing action is NOT this gate's business: the tool schema requires one, so an absent
    // action is a malformed call whose refusal the LIBRARY owns ("Unknown action") — answering
    // E-318 would send the model to read a skill for a call that cannot work (review 2026-09-26,
    // P2). The rule's default-to-`patch` (V6-26) stays where it belongs, on the plan path.
    if (view.action === undefined) return null
    if (!isUnreadWrite({ action: view.action, name: view.name }, readNames)) return null
    return errorText('e-318-skill-write-without-a-read', { a1: view.name })
  },
}

/**
 * The confirm gate (design §4.1): a foreground create, or a bare foreground delete, is
 * irreversible and gets ONE question. Admission only — a replayed record already carries the human
 * release that staged it, so asking there would be the second interruption for one write.
 *
 * `delete` with `absorbed_into` is exempt: that is the merge protocol (an umbrella absorbs the source),
 * and asking once per absorbed skill would turn one merge into N questions. A BARE delete is the
 * destructive primitive the plan layer reserves for a human — a review may only delete into an
 * umbrella (core's `SKILL_ACTION_REQUIRED_FIELDS` docblock).
 *
 * The gate is UX, not a security door (those are policy protection and read-before-write): the seam
 * is required to be total, so an unmounted question service or a caller that is not the live root
 * agent PROCEEDS — the operator's own session is the authority that asked for the write.
 */
const HUMAN_CONFIRM: WriteGate = {
  id: 'human-confirm',
  appliesTo: ['admission'],
  run: async ({ view, origin, confirm, warn }) => {
    const action = view.action
    if (action === undefined || origin !== 'foreground' || view.name === '') return null
    const destructive = action === 'create' || (action === 'delete' && view.absorbedInto === undefined)
    if (!destructive) return null
    if (confirm === undefined) {
      warn('skill_manage: no confirmation channel is mounted, so the write proceeds unconfirmed.')
      return null
    }
    const confirmLabel = action === 'create' ? 'Create' : 'Delete'
    const confirmed = await confirm({
      action,
      name: view.name,
      confirmLabel,
      question: {
        id: CONFIRM_QUESTION_ID,
        header: 'Confirm',
        question: action === 'create'
          ? `Create skill "${view.name}"? A new skill directory is written into the family tree.`
          : `Delete skill "${view.name}"? It is archived under .archive and leaves the catalog.`,
        options: [{ label: confirmLabel }, { label: CANCEL_LABEL }],
      },
    })
    if (confirmed) return null
    return errorText('e-317-skill-write-not-confirmed', {
      a1: view.name,
      a2: action === 'create' ? 'created' : 'deleted',
    })
  },
}

/** The sequence, in order. A gate whose `appliesTo` omits the asking point is skipped. */
const GATES: readonly WriteGate[] = [ARGUMENT_SHAPE, MISSING_ARGS, POLICY_PROTECTION, READ_BEFORE_WRITE, HUMAN_CONFIRM]

/**
 * Run the sequence for one write attempt.
 * @param context - the asking point, the write, and the seams the human-facing gate needs.
 * @returns the FIRST refusal, or null when every applicable gate passed. Both points return the
 *   message as the tool result unchanged, so the two entries refuse with identical wording.
 */
export async function runWriteGates(context: WriteGateContext): Promise<string | null> {
  const input: WriteGateInput = { ...context, view: gateArgsOf(context.args) }
  for (const gate of GATES) {
    if (!gate.appliesTo.includes(context.point)) continue
    const refusal = await gate.run(input)
    if (refusal !== null) return refusal
  }
  return null
}
