/**
 * Deterministic validator for model-produced evolution plans.
 * The validator never calls the model and never mutates state.
 * @module @deepseek-ai/dsh-evolution-plan-validator
 */

import { DEFAULT_MAX_OPS_PER_PLAN, DEFAULT_MEMORY_CHAR_LIMIT, DEFAULT_SKILL_CONTENT_CHARS, DEFAULT_USER_CHAR_LIMIT, FORBIDDEN_CONTROL_KEYS, MAX_RESTRUCTURE_MOVES, SKILL_ACTION_REQUIRED_FIELDS, validateRestructureTarget } from '@deepseek-ai/dsh-evolution-core'

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

export interface ValidationResult {
  accepted: EvolutionPlan
  rejected: RejectedOp[]
  ok: boolean
}

const MEMORY_ACTIONS = new Set(['add', 'replace', 'remove'])
const SKILL_ACTIONS = new Set(['create', 'edit', 'update', 'patch', 'delete', 'write_file', 'remove_file', 'restructure'])
// 0.3.17 (S3.10, T-1): single source lives in core constants.
const FORBIDDEN_KEYS: readonly string[] = FORBIDDEN_CONTROL_KEYS

/** v31 REV-08 (stated honestly): this gate is SEQUENCE-RANGE ONLY — every
 * evidence item must carry an integer seq within [0, sessionSeq]. There is NO
 * quoted-text/content verification: a model can satisfy it by citing any
 * in-range event (even an unrelated one). Anti-fabrication strength lives in
 * read-before-write, budgets, and the threat scan — not here. */
function hasValidEvidence(evidence: unknown, sessionSeq: number): boolean {
  if (!Array.isArray(evidence) || evidence.length === 0) return false
  return evidence.every((item) => {
    if (!item || typeof item !== 'object') return false
    const record = item as Record<string, unknown>
    // P3 (v3 audit): only a REAL numeric seq passes — Number(null)/Number('')/
    // Number(false) coerce to 0 and would mint fake evidence order.
    const seq = typeof record.event_seq === 'number'
      ? record.event_seq
      : typeof record.seq === 'number' ? record.seq
        : typeof record.event_seq === 'string' && /^\d+$/.test(record.event_seq)
          ? Number(record.event_seq)
          : -1
    return Number.isInteger(seq) && seq >= 0 && seq <= sessionSeq
  })
}

/** Object root guard (V4-23, symmetric with the maintain validator): null,
 * primitives and arrays are not a plan record and must be rejected with an
 * explicit message, never a raw TypeError from `.memoryOps`/`.summary`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateEvolutionPlan(plan: EvolutionPlan, context: ValidationContext): ValidationResult {
  // V4-23 root guard (symmetric with the maintain validator): null, primitives
  // and arrays are not a plan record and must be rejected explicitly, never a
  // raw TypeError from `.memoryOps`/`.summary`. `plan` is typed non-null, so
  // the check runs through an `unknown` local to stay TS-clean.
  const root: unknown = plan
  if (!isRecord(root)) {
    return {
      accepted: { memoryOps: [], skillOps: [] },
      rejected: [{ index: 0, kind: 'memory', reason: 'plan root: must be an object' }],
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
    return { accepted, rejected, ok: false }
  }
  if (allOps > maxOps) {
    rejected.push({ index: 0, kind: 'memory', reason: `plan exceeds maxOpsPerPlan ${maxOps}` })
    return { accepted, rejected, ok: false }
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
    const reason = validateMemoryOp(op, context, index)
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
    const reason = validateSkillOp(op, context, index)
    if (reason) rejected.push({ index, kind: 'skill', reason })
    // V6-26 (0.3.37): accept the op with an EXPLICIT action (missing defaults to
    // 'patch' at the op level, not at the consumer) — every downstream check
    // (read-before-write filter, execute dispatch) sees the same truth and the
    // "both sides happen to default" fragility is gone.
    else skillOps.push(op.action === undefined ? { ...op, action: 'patch' } : op)
  }

  return { accepted, rejected, ok: rejected.length === 0 && (memoryOps.length + skillOps.length > 0) }
}

function validateMemoryOp(op: MemoryOp, context: ValidationContext, index: number): string | null {
  // P2-1 (v15): field-level type guard — `??` chains only paper over
  // null/undefined, so a non-string truthy field (e.g. `facts: {...}`)
  // reached `.trim()` and threw a TypeError out of the "deterministic
  // validator", failing the WHOLE review round (the exact shape E-60 killed
  // at the op level). Reject per-op instead.
  const badField = malformedStringField(op, ['facts', 'content', 'old_text', 'target'])
  if (badField) return `memory op ${index}: field ${badField} must be a string`
  if (!hasValidEvidence(op.evidence, context.sessionSeq)) return `memory op ${index}: evidence is required and must reference a valid session seq`
  for (const key of FORBIDDEN_KEYS) if (key in op) return `memory op ${index}: forbidden field ${key}`
  if (op.target !== 'memory' && op.target !== 'user') return `memory op ${index}: target must be memory or user`
  const action = op.action ?? 'add'
  if (!MEMORY_ACTIONS.has(action)) return `memory op ${index}: unknown action ${action}`
  const text = (op.facts ?? op.content ?? '').trim()
  if (action !== 'remove' && text.length === 0) return `memory op ${index}: ${action} requires facts/content`
  if (action !== 'add' && !(op.old_text ?? '').trim()) return `memory op ${index}: ${action} requires old_text`
  const budget = op.target === 'user' ? (context.maxUserChars ?? DEFAULT_USER_CHAR_LIMIT) : (context.maxMemoryChars ?? DEFAULT_MEMORY_CHAR_LIMIT)
  if (text.length > budget) return `memory op ${index}: content exceeds ${op.target === 'user' ? 'user' : 'memory'} budget`
  return null
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

function validateSkillOp(op: SkillOp, context: ValidationContext, index: number): string | null {
  // P2-1 (v15): field-level type guard (see validateMemoryOp).
  // v16 (P2 follow-up): `file_path` added — the executors pass it verbatim
  // into validateSupportPath's string replace; a non-string truthy value
  // used to escape the validator and TypeError mid-plan.
  const badField = malformedStringField(op, ['name', 'content', 'old_string', 'new_string', 'file_path', 'file_content', 'absorbed_into'])
  if (badField) return `skill op ${index}: field ${badField} must be a string`
  for (const key of FORBIDDEN_KEYS) if (key in op) return `skill op ${index}: forbidden field ${key}`
  const name = (op.name ?? '').trim()
  if (!name) return `skill op ${index}: name is required`
  if (context.protectedSkillNames?.has(name)) return `skill op ${index}: skill "${name}" is protected`
  if (!hasValidEvidence(op.evidence, context.sessionSeq)) return `skill op ${index}: evidence is required and must reference a valid session seq`
  const action = op.action ?? 'patch'
  if (!SKILL_ACTIONS.has(action)) return `skill op ${index}: unknown action ${action}`
  // OPT-05 (2026-09): required-field gate from the SAME table the tool's
  // argument gate reads (core SKILL_ACTION_REQUIRED_FIELDS). A plan was able
  // to pass validation with a write_file/remove_file that had no file_path —
  // the staged write then failed deterministically at every approve. Only
  // missing (null/undefined) fields are caught here; payload emptiness keeps
  // its dedicated `.trim()` checks below (their wording is pinned by tests).
  const requiredFields = SKILL_ACTION_REQUIRED_FIELDS[action]
  if (requiredFields !== undefined) {
    const record = op as unknown as Record<string, unknown>
    for (const field of requiredFields) {
      if (record[field] === undefined || record[field] === null) return `skill op ${index}: ${action} requires ${field}`
    }
  }
  if ((action === 'create' || action === 'edit' || action === 'update') && !(op.content ?? '').trim()) {
    return `skill op ${index}: ${action} requires content`
  }
  if (action === 'patch' && !(op.old_string ?? '')) return `skill op ${index}: patch requires old_string`
  // Hermes background guard: a review pass may only DELETE into an explicit
  // absorbed_into umbrella target — a bare delete is reserved for the
  // deterministic curator channel and the user's foreground path.
  if (action === 'delete' && !(op.absorbed_into ?? '').trim()) return `skill op ${index}: delete requires absorbed_into`
  // 0.3.17 (E-27): a patch's new_string IS the write payload — the budget
  // must see it too (threat scanning already treats it as real field).
  // 0.3.20 (N-3): the three payload fields are ALTERNATIVES (the executor
  // writes file_content / content / new_string depending on the action), so
  // the budget checks the MAX — the previous `??` chain let an empty earlier
  // field (e.g. content:'') shadow a huge new_string.
  const writeBytes = [op.file_content ?? '', op.content ?? '', op.new_string ?? '']
    .reduce((max, value) => Math.max(max, value.length), 0)
  // P3 (v15): executor parity — the executor reads `args.file_content ?? ''`
  // ONLY (tool-skill-manage executeCore), so the validator's `?? op.content`
  // fallback used to admit a write_file that then wrote an EMPTY support file
  // and counted a successful write. Same field, or it does not pass.
  if (action === 'write_file' && !(op.file_content ?? '').trim()) return `skill op ${index}: write_file requires file_content`
  if (writeBytes > (context.maxSkillContentChars ?? DEFAULT_SKILL_CONTENT_CHARS)) return `skill op ${index}: content exceeds skill budget`
  if (action === 'restructure') {
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
  }
  return null
}
