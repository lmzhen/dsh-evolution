/**
 * Deterministic validator for model-produced evolution plans.
 * The validator never calls the model and never mutates state.
 * @module @deepseek-ai/dsh-evolution-plan-validator
 */

import { DEFAULT_MAX_OPS_PER_PLAN, DEFAULT_MEMORY_CHAR_LIMIT, DEFAULT_SKILL_CONTENT_CHARS, DEFAULT_USER_CHAR_LIMIT, FORBIDDEN_CONTROL_KEYS, MAX_RESTRUCTURE_MOVES, RESTRUCTURE_TARGET_RE } from '@deepseek-ai/dsh-evolution-core'

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

export function validateEvolutionPlan(plan: EvolutionPlan, context: ValidationContext): ValidationResult {
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
    else memoryOps.push(op)
  }

  for (const [index, rawOp] of ((rawSkillOps ?? []) as unknown[]).entries()) {
    if (rawOp === null || typeof rawOp !== 'object' || Array.isArray(rawOp)) {
      rejected.push({ index, kind: 'skill', reason: `skill op ${index}: malformed operation (expected an object)` })
      continue
    }
    const op = rawOp as SkillOp
    const reason = validateSkillOp(op, context, index)
    if (reason) rejected.push({ index, kind: 'skill', reason })
    else skillOps.push(op)
  }

  return { accepted, rejected, ok: rejected.length === 0 && (memoryOps.length + skillOps.length > 0) }
}

function validateMemoryOp(op: MemoryOp, context: ValidationContext, index: number): string | null {
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

function validateSkillOp(op: SkillOp, context: ValidationContext, index: number): string | null {
  for (const key of FORBIDDEN_KEYS) if (key in op) return `skill op ${index}: forbidden field ${key}`
  const name = (op.name ?? '').trim()
  if (!name) return `skill op ${index}: name is required`
  if (context.protectedSkillNames?.has(name)) return `skill op ${index}: skill "${name}" is protected`
  if (!hasValidEvidence(op.evidence, context.sessionSeq)) return `skill op ${index}: evidence is required and must reference a valid session seq`
  const action = op.action ?? 'patch'
  if (!SKILL_ACTIONS.has(action)) return `skill op ${index}: unknown action ${action}`
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
  if (action === 'write_file' && !(op.file_content ?? op.content ?? '').trim()) return `skill op ${index}: write_file requires file_content`
  if (writeBytes > (context.maxSkillContentChars ?? DEFAULT_SKILL_CONTENT_CHARS)) return `skill op ${index}: content exceeds skill budget`
  if (action === 'restructure') {
    if (!Array.isArray(op.restructure) || op.restructure.length === 0) return `skill op ${index}: restructure requires a non-empty restructure list`
    if (op.restructure.length > MAX_RESTRUCTURE_MOVES) return `skill op ${index}: restructure exceeds ${MAX_RESTRUCTURE_MOVES} moves`
    for (const [moveIndex, move] of op.restructure.entries()) {
      if (!move || typeof move.heading !== 'string' || !move.heading.trim()) {
        return `skill op ${index}: restructure[${moveIndex}] requires a non-empty heading`
      }
      if (typeof move.to_file !== 'string' || !RESTRUCTURE_TARGET_RE.test(move.to_file)) {
        return `skill op ${index}: restructure[${moveIndex}] to_file must be references/<topic>.md`
      }
    }
  }
  return null
}
