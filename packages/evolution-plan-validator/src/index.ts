/**
 * Deterministic validator for model-produced evolution plans.
 * The validator never calls the model and never mutates state.
 *
 * The per-op questions are a NAMED, ORDERED TABLE (design
 * `dsh-evolution-skill-history-design.md` §3D), the same form as the tool path's
 * `tool-skill-manage/src/write-gates.ts`: the rule BODIES read the shared core tables
 * (`FORBIDDEN_CONTROL_KEYS`, `SKILL_ACTION_REQUIRED_FIELDS`, the restructure-target
 * rule), and this module owns the ORDER and the wording. Order is part of the contract — the first
 * refusing rule names the reason the model reads — and container-level rejections (a non-array
 * `skillOps`, a malformed entry) stay outside the tables because they judge the container,
 * not an operation.
 *
 * One row is REPORT-ONLY: `EVIDENCE_CLASS` records a finding in
 * `ValidationResult.reports` and never refuses an op. It is phase 1 of the
 * evidence-consistency rule — the range rule cannot tell a real exchange from a `turn/start`
 * boundary, and refusing on that difference is a later decision this observation window has to
 * earn (design §3D, §5.5).
 * @module @deepseek-ai/dsh-evolution-plan-validator
 */

import { DEFAULT_MAX_OPS_PER_PLAN, DEFAULT_MEMORY_CHAR_LIMIT, DEFAULT_SKILL_CONTENT_CHARS, DEFAULT_USER_CHAR_LIMIT, FORBIDDEN_CONTROL_KEYS, MAX_RESTRUCTURE_MOVES, SKILL_ACTION_REQUIRED_FIELDS, payloadText, validateRestructureTarget, type EvidenceIndex } from '@deepseek-ai/dsh-evolution-core'

export interface MemoryOp {
  target?: string
  action?: string
  facts?: string
  content?: string
  old_text?: string
  evidence?: unknown[]
}

export interface SkillOp {
  action?: string
  name?: string
  content?: string
  /** write_file payload (the tool reads `file_content`, not `content`). */
  file_content?: string
  old_string?: string
  new_string?: string
  file_path?: string
  /** S1-C1 (0.3.80): patch replaces EVERY occurrence when true — the same
   * contract `skill_manage` documents to the model. Previously the validator
   * neither knew nor rejected this field while the review executor hardcoded
   * first-occurrence-only, so a plan carrying `replace_all` silently shrank
   * to a single replacement and still reported success. */
  replace_all?: boolean
  absorbed_into?: string
  /** restructure payload: body sections moved to references/ (008 batch B). */
  restructure?: Array<{ heading?: string; to_file?: string } | null>
  evidence?: unknown[]
}

export interface EvolutionPlan {
  memoryOps?: MemoryOp[]
  skillOps?: SkillOp[]
  summary?: string
}

export interface ValidationContext {
  /** Upper bound for the latest valid session seq. */
  sessionSeq: number
  /** Which frames carry CONTENT (core `EvidenceIndex`), or `undefined` when the caller
   * cannot classify the log. Read by the report-only `EVIDENCE_CLASS` row only: an op whose
   * entire citation list is a bookkeeping frame (`turn/start`, `step/start`, …) becomes
   * visible without being refused.
   *
   * Two producers satisfy it: the dense whole-log reader (`evidenceKindIndex`) and the live
   * session projection (`sessionEvidenceIndex`, the complement over boundary seqs) — the
   * consumer asks one question (`has`), so either answers it. */
  substantiveEvidenceSeqs?: EvidenceIndex | undefined
  maxOpsPerPlan?: number
  protectedSkillNames?: ReadonlySet<string>
  maxMemoryChars?: number
  maxUserChars?: number
  maxSkillContentChars?: number
}

export interface RejectedOp {
  index: number
  kind: 'memory' | 'skill'
  reason: string
}

/** The op kinds a plan carries, and the two keys of {@link PLAN_RULES}. */
export type PlanOpKind = 'memory' | 'skill'

/** One report-only finding: a rule that let the op proceed and still had something to say.
 * `ValidationResult.ok` ignores this list — a report is never a refusal. */
export interface PlanRuleReport {
  /** The reporting rule's id from {@link PLAN_RULES}. */
  rule: string
  kind: PlanOpKind
  index: number
  reason: string
}

export interface ValidationResult {
  accepted: EvolutionPlan
  rejected: RejectedOp[]
  /** Findings from the report-only rows; empty when every op was either clean or refused. */
  reports: PlanRuleReport[]
  ok: boolean
}

/** What one rule reads: the op, which table it came from, and the caller's context. */
export interface PlanRuleInput<Op> {
  readonly op: Op
  readonly kind: PlanOpKind
  readonly index: number
  readonly context: ValidationContext
}

/** One named question the plan path asks about ONE op. */
export interface PlanRule<Op> {
  /** Stable id: a report cites it, and the table's order is the refusal order. */
  readonly id: string
  /** Records the verdict in `ValidationResult.reports` instead of refusing the op. */
  readonly reportOnly?: boolean
  /** @returns the refusal reason, or null to let the op proceed. */
  run(input: PlanRuleInput<Op>): string | null
}

const MEMORY_ACTIONS = new Set(['add', 'replace', 'remove'])
const SKILL_ACTIONS = new Set(['create', 'edit', 'update', 'patch', 'delete', 'write_file', 'remove_file', 'restructure'])
// 0.3.17 (S3.10, T-1): single source lives in core constants.
const FORBIDDEN_KEYS: readonly string[] = FORBIDDEN_CONTROL_KEYS

/** The seq ONE evidence item cites, or -1 when it cites none.
 *
 * P3 (v3 audit): only a REAL numeric seq passes — Number(null)/Number('')/Number(false) coerce
 * to 0 and would mint fake evidence order. */
function citedEvidenceSeq(item: unknown): number {
  if (!item || typeof item !== 'object') return -1
  const record = item as Record<string, unknown>
  return typeof record.event_seq === 'number'
    ? record.event_seq
    : typeof record.seq === 'number' ? record.seq
      : typeof record.event_seq === 'string' && /^[0-9]+$/.test(record.event_seq)
        ? Number(record.event_seq)
        : -1
}

/** v31 REV-08 (stated honestly): this gate is SEQUENCE-RANGE ONLY — every evidence item must
 * carry an integer seq within [0, sessionSeq]. There is NO quoted-text/content verification: a
 * model can satisfy it by citing any in-range event (even an unrelated one). Anti-fabrication
 * strength lives in read-before-write, budgets, and the threat scan — not here. The CLASS of the
 * cited frame is a separate, report-only question (`EVIDENCE_CLASS`). */
function hasValidEvidence(evidence: unknown, sessionSeq: number): boolean {
  if (!Array.isArray(evidence) || evidence.length === 0) return false
  return evidence.every((item) => {
    const seq = citedEvidenceSeq(item)
    return Number.isInteger(seq) && seq >= 0 && seq <= sessionSeq
  })
}

/** EVIDENCE_CLASS — phase 1 of the evidence-consistency question: does ANY cited frame carry
 * content? An op whose whole citation list is a turn/step boundary is reported, never refused.
 *
 * `undefined` is not an empty set: a caller that could not classify the log has nothing to
 * say, and reporting every op would be the false-positive flood this phase exists to avoid. */
function bookkeepingEvidenceReason<Op extends { evidence?: unknown[] }>(input: PlanRuleInput<Op>): string | null {
  const substantive = input.context.substantiveEvidenceSeqs
  if (substantive === undefined) return null
  const evidence = input.op.evidence
  if (!Array.isArray(evidence) || evidence.length === 0) return null
  if (evidence.some(item => substantive.has(citedEvidenceSeq(item)))) return null
  return `${input.kind} op ${input.index}: every cited evidence seq is a turn/step boundary frame — no content frame backs this op`
}

/** P2-1 (v15): the string-typed fields the executors dereference with
 * `.trim()`/`.length`. `target` is included for memory ops because the
 * engine compares it against literals. */
function malformedStringField(op: object, fields: readonly string[]): string | null {
  const record = op as Record<string, unknown>
  for (const field of fields) {
    const value = record[field]
    if (value !== undefined && value !== null && typeof value !== 'string') return field
  }
  return null
}

/** The memory op's questions, in the order the model meets them. */
const MEMORY_PLAN_RULES: readonly PlanRule<MemoryOp>[] = [
  {
    // P2-1 (v15): field-level type guard — `??` chains only paper over
    // null/undefined, so a non-string truthy field (e.g. `facts: {...}`)
    // reached `.trim()` and threw a TypeError out of the "deterministic
    // validator", failing the WHOLE review round (the exact shape E-60 killed
    // at the op level). Reject per-op instead.
    id: 'FIELD_TYPE',
    run: ({ op, index }) => {
      const badField = malformedStringField(op, ['facts', 'content', 'old_text', 'target'])
      return badField === null ? null : `memory op ${index}: field ${badField} must be a string`
    },
  },
  {
    id: 'EVIDENCE_RANGE',
    run: ({ op, index, context }) => (hasValidEvidence(op.evidence, context.sessionSeq)
      ? null
      : `memory op ${index}: evidence is required and must reference a valid session seq`),
  },
  {
    id: 'CONTROL_KEYS',
    run: ({ op, index }) => {
      for (const key of FORBIDDEN_KEYS) if (key in op) return `memory op ${index}: forbidden field ${key}`
      return null
    },
  },
  {
    id: 'TARGET',
    run: ({ op, index }) => (op.target === 'memory' || op.target === 'user'
      ? null
      : `memory op ${index}: target must be memory or user`),
  },
  {
    id: 'ACTION',
    run: ({ op, index }) => {
      const action = op.action ?? 'add'
      return MEMORY_ACTIONS.has(action) ? null : `memory op ${index}: unknown action ${action}`
    },
  },
  {
    // T3-06/A34: the payload is core's `payloadText` — the first NON-BLANK of
    // facts/content. With `facts ?? content` a blank `facts` shadowed a body the
    // op did carry, and the plan was refused as empty.
    id: 'PAYLOAD',
    run: ({ op, index }) => {
      const action = op.action ?? 'add'
      return action !== 'remove' && payloadText(op).length === 0 ? `memory op ${index}: ${action} requires facts/content` : null
    },
  },
  {
    id: 'ANCHOR',
    run: ({ op, index }) => {
      const action = op.action ?? 'add'
      return action !== 'add' && !(op.old_text ?? '').trim() ? `memory op ${index}: ${action} requires old_text` : null
    },
  },
  {
    id: 'BUDGET',
    run: ({ op, index, context }) => {
      const text = payloadText(op)
      const budget = op.target === 'user' ? (context.maxUserChars ?? DEFAULT_USER_CHAR_LIMIT) : (context.maxMemoryChars ?? DEFAULT_MEMORY_CHAR_LIMIT)
      return text.length > budget
        ? `memory op ${index}: content exceeds ${op.target === 'user' ? 'user' : 'memory'} budget`
        : null
    },
  },
  { id: 'EVIDENCE_CLASS', reportOnly: true, run: bookkeepingEvidenceReason },
]

/** The skill op's questions, in the order the model meets them. */
const SKILL_PLAN_RULES: readonly PlanRule<SkillOp>[] = [
  {
    // P2-1 (v15): field-level type guard (see the memory table).
    // v16 (P2 follow-up): `file_path` added — the executors pass it verbatim
    // into validateSupportPath's string replace; a non-string truthy value
    // used to escape the validator and TypeError mid-plan.
    id: 'FIELD_TYPE',
    run: ({ op, index }) => {
      const badField = malformedStringField(op, ['name', 'content', 'old_string', 'new_string', 'file_path', 'file_content', 'absorbed_into'])
      return badField === null ? null : `skill op ${index}: field ${badField} must be a string`
    },
  },
  {
    // S1-C1: replace_all is a BOOLEAN flag (the executor passes it verbatim into
    // the library patch); a non-boolean truthy value would still have "worked",
    // but a string 'false' flipping the semantics is the kind of silent surprise
    // the validator exists to catch.
    id: 'REPLACE_ALL',
    run: ({ op, index }) => (op.replace_all === undefined || typeof op.replace_all === 'boolean'
      ? null
      : `skill op ${index}: field replace_all must be a boolean`),
  },
  {
    id: 'CONTROL_KEYS',
    run: ({ op, index }) => {
      for (const key of FORBIDDEN_KEYS) if (key in op) return `skill op ${index}: forbidden field ${key}`
      return null
    },
  },
  {
    id: 'NAME',
    run: ({ op, index }) => ((op.name ?? '').trim() ? null : `skill op ${index}: name is required`),
  },
  {
    id: 'PROTECTED',
    run: ({ op, index, context }) => {
      const name = (op.name ?? '').trim()
      return context.protectedSkillNames?.has(name) ? `skill op ${index}: skill "${name}" is protected` : null
    },
  },
  {
    id: 'EVIDENCE_RANGE',
    run: ({ op, index, context }) => (hasValidEvidence(op.evidence, context.sessionSeq)
      ? null
      : `skill op ${index}: evidence is required and must reference a valid session seq`),
  },
  {
    id: 'ACTION',
    run: ({ op, index }) => {
      const action = op.action ?? 'patch'
      return SKILL_ACTIONS.has(action) ? null : `skill op ${index}: unknown action ${action}`
    },
  },
  {
    // OPT-05 (2026-09): required-field gate from the SAME table the tool's
    // argument gate reads (core SKILL_ACTION_REQUIRED_FIELDS). A plan was able
    // to pass validation with a write_file/remove_file that had no file_path —
    // the staged write then failed deterministically at every approve. Only
    // missing (null/undefined) fields are caught here; payload emptiness keeps
    // its dedicated `.trim()` checks in the rows below (their wording is
    // pinned by tests).
    id: 'REQUIRED_FIELDS',
    run: ({ op, index }) => {
      const action = op.action ?? 'patch'
      const requiredFields = SKILL_ACTION_REQUIRED_FIELDS[action]
      if (requiredFields === undefined) return null
      const record = op as unknown as Record<string, unknown>
      for (const field of requiredFields) {
        if (record[field] === undefined || record[field] === null) return `skill op ${index}: ${action} requires ${field}`
      }
      return null
    },
  },
  {
    id: 'WRITE_PAYLOAD',
    run: ({ op, index }) => {
      const action = op.action ?? 'patch'
      return (action === 'create' || action === 'edit' || action === 'update') && !(op.content ?? '').trim()
        ? `skill op ${index}: ${action} requires content`
        : null
    },
  },
  {
    id: 'PATCH_ANCHOR',
    run: ({ op, index }) => (op.action === 'patch' && !(op.old_string ?? '')
      ? `skill op ${index}: patch requires old_string`
      : null),
  },
  {
    // Hermes background guard: a review pass may only DELETE into an explicit
    // absorbed_into umbrella target — a bare delete is reserved for the
    // deterministic curator channel and the user's foreground path.
    id: 'DELETE_TARGET',
    run: ({ op, index }) => (op.action === 'delete' && !(op.absorbed_into ?? '').trim()
      ? `skill op ${index}: delete requires absorbed_into`
      : null),
  },
  {
    // P3 (v15): executor parity — the executor reads `args.file_content ?? ''`
    // ONLY (tool-skill-manage executeCore), so the validator's `?? op.content`
    // fallback used to admit a write_file that then wrote an EMPTY support file
    // and counted a successful write. Same field, or it does not pass.
    id: 'SUPPORT_PAYLOAD',
    run: ({ op, index }) => (op.action === 'write_file' && !(op.file_content ?? '').trim()
      ? `skill op ${index}: write_file requires file_content`
      : null),
  },
  {
    // 0.3.17 (E-27): a patch's new_string IS the write payload — the budget
    // must see it too (threat scanning already treats it as real field).
    // 0.3.20 (N-3): the three payload fields are ALTERNATIVES (the executor
    // writes file_content / content / new_string depending on the action), so
    // the budget checks the MAX — the previous `??` chain let an empty
    // earlier field (e.g. content:'') shadow a huge new_string.
    id: 'BUDGET',
    run: ({ op, index, context }) => {
      const writeBytes = [op.file_content ?? '', op.content ?? '', op.new_string ?? '']
        .reduce((max, value) => Math.max(max, value.length), 0)
      return writeBytes > (context.maxSkillContentChars ?? DEFAULT_SKILL_CONTENT_CHARS)
        ? `skill op ${index}: content exceeds skill budget`
        : null
    },
  },
  {
    id: 'RESTRUCTURE',
    run: ({ op, index }) => {
      if (op.action !== 'restructure') return null
      if (!Array.isArray(op.restructure) || op.restructure.length === 0) return `skill op ${index}: restructure requires a non-empty restructure list`
      if (op.restructure.length > MAX_RESTRUCTURE_MOVES) return `skill op ${index}: restructure exceeds ${MAX_RESTRUCTURE_MOVES} moves`
      for (const [moveIndex, move] of op.restructure.entries()) {
        if (!move || typeof move.heading !== 'string' || !move.heading.trim()) {
          return `skill op ${index}: restructure[${moveIndex}] requires a non-empty heading`
        }
        if (typeof move.to_file !== 'string') {
          return `skill op ${index}: restructure[${moveIndex}] to_file must be references/<topic>.md`
        }
        // A1-6 (v18): the single validator also rejects Windows device stems,
        // so a plan cannot target `references/nul.md` (unmanageable afterwards).
        const targetIssue = validateRestructureTarget(move.to_file)
        if (targetIssue) return `skill op ${index}: restructure[${moveIndex}] ${targetIssue}`
      }
      return null
    },
  },
  { id: 'EVIDENCE_CLASS', reportOnly: true, run: bookkeepingEvidenceReason },
]

/**
 * The plan path's rule tables, by op kind — the named set whose ORDER this module owns.
 *
 * Exported so a rename or a reorder is a visible change (the suite pins the ids), and so the tool
 * path's gate table and this one can be compared side by side without reading either
 * implementation.
 */
export const PLAN_RULES = {
  memory: MEMORY_PLAN_RULES,
  skill: SKILL_PLAN_RULES,
} as const

/** Run one op's table in order: the first refusing rule names the reason, a report-only row
 * records its verdict and lets the op continue. */
function runPlanRules<Op extends { evidence?: unknown[] }>(
  rules: readonly PlanRule<Op>[],
  op: Op,
  context: ValidationContext,
  index: number,
  kind: PlanOpKind,
  reports: PlanRuleReport[],
): string | null {
  for (const rule of rules) {
    const reason = rule.run({ op, kind, index, context })
    if (reason === null) continue
    if (rule.reportOnly === true) {
      reports.push({ rule: rule.id, kind, index, reason })
      continue
    }
    return reason
  }
  return null
}

/** Object root guard (V4-23, symmetric with the maintain validator): null,
 * primitives and arrays are not a plan record and must be rejected with an
 * explicit message, never a raw TypeError from `.memoryOps`/`.summary`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateEvolutionPlan(plan: EvolutionPlan, context: ValidationContext): ValidationResult {
  const reports: PlanRuleReport[] = []
  // V4-23 root guard (symmetric with the maintain validator): null, primitives
  // and arrays are not a plan record and must be rejected explicitly, never a
  // raw TypeError from `.memoryOps`/`.summary`. `plan` is typed non-null,
  // so the check runs through an `unknown` local to stay TS-clean.
  const root: unknown = plan
  if (!isRecord(root)) {
    return {
      accepted: { memoryOps: [], skillOps: [] },
      rejected: [{ index: 0, kind: 'memory', reason: 'plan root: must be an object' }],
      reports,
      ok: false,
    }
  }
  const maxOps = context.maxOpsPerPlan ?? DEFAULT_MAX_OPS_PER_PLAN
  const rejected: RejectedOp[] = []
  const memoryOps: MemoryOp[] = []
  const skillOps: SkillOp[] = []
  const accepted: EvolutionPlan = { memoryOps, skillOps, ...plan.summary === undefined ? {} : { summary: plan.summary } }

  // F-319: `plan.memoryOps`/`plan.skillOps` can be a non-array container with
  // a truthy `.length` (e.g. `{"length":2}`); the old code counted that length,
  // passed the empty/maxOps gates, then threw on `.entries()`. Resolve the
  // array-ness up front — absent is empty, present-but-not-an-array is a
  // per-container rejection (E-60's per-item contract, never a throw).
  const rawMemoryOps = Array.isArray(plan.memoryOps) ? plan.memoryOps : undefined
  const rawSkillOps = Array.isArray(plan.skillOps) ? plan.skillOps : undefined
  const allOps = (rawMemoryOps?.length ?? 0) + (rawSkillOps?.length ?? 0)
  if (plan.memoryOps !== undefined && !Array.isArray(plan.memoryOps)) {
    rejected.push({ index: 0, kind: 'memory', reason: 'memoryOps: must be an array' })
  }
  if (plan.skillOps !== undefined && !Array.isArray(plan.skillOps)) {
    rejected.push({ index: 0, kind: 'skill', reason: 'skillOps: must be an array' })
  }
  if (allOps === 0 && rejected.length === 0) {
    rejected.push({ index: 0, kind: 'memory', reason: 'plan contains no operations' })
    return { accepted, rejected, reports, ok: false }
  }
  if (allOps > maxOps) {
    rejected.push({ index: 0, kind: 'memory', reason: `plan exceeds maxOpsPerPlan ${maxOps}` })
    return { accepted, rejected, reports, ok: false }
  }

  // Items stay `unknown` (cast below) so the per-item malformed guards remain
  // meaningful to the type-aware linter: an array's ELEMENTS may still be
  // scalars even though the container itself is a well-formed array.
  for (const [index, rawOp] of ((rawMemoryOps ?? []) as unknown[]).entries()) {
    // 0.3.17 (E-60): a malformed entry (null/string/array) used to throw a
    // TypeError from the validator — the caller hands it MODEL OUTPUT; a
    // deterministic validator rejects per-item instead.
    if (rawOp === null || typeof rawOp !== 'object' || Array.isArray(rawOp)) {
      rejected.push({ index, kind: 'memory', reason: `memory op ${index}: malformed operation (expected an object)` })
      continue
    }
    const op = rawOp as MemoryOp
    const reason = runPlanRules(MEMORY_PLAN_RULES, op, context, index, 'memory', reports)
    if (reason) rejected.push({ index, kind: 'memory', reason })
    // V8-23⑪ (0.3.49): the V6-26 explicit-action normalization applied to
    // skillOps only — a memory op without `action` was written to `accepted`
    // raw, so every new consumer had to guess the 'add' default itself.
    else memoryOps.push(op.action === undefined ? { ...op, action: 'add' } : op)
  }

  for (const [index, rawOp] of ((rawSkillOps ?? []) as unknown[]).entries()) {
    if (rawOp === null || typeof rawOp !== 'object' || Array.isArray(rawOp)) {
      rejected.push({ index, kind: 'skill', reason: `skill op ${index}: malformed operation (expected an object)` })
      continue
    }
    const op = rawOp as SkillOp
    const reason = runPlanRules(SKILL_PLAN_RULES, op, context, index, 'skill', reports)
    if (reason) rejected.push({ index, kind: 'skill', reason })
    // V6-26 (0.3.37): accept the op with an EXPLICIT action (missing defaults to
    // 'patch' at the op level, not at the consumer) — every downstream check
    // (read-before-write filter, execute dispatch) sees the same truth and the
    // "both sides happen to default" fragility is gone.
    else skillOps.push(op.action === undefined ? { ...op, action: 'patch' } : op)
  }

  return { accepted, rejected, reports, ok: rejected.length === 0 && (memoryOps.length + skillOps.length > 0) }
}
