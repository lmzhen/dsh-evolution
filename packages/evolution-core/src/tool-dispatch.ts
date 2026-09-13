/**
 * The family's ONE reader of platform tool-dispatch events.
 *
 * The platform records a finished tool call under two different event
 * vocabularies and only one of them is written per dispatch, chosen by the
 * mounted tool runtime's mode:
 *
 * - native mode: \`tool/call\` (with \`callId\`) settled by \`tool/result\`, the
 *   write sites being core/agent-loop/src/tool-calls.ts:264 and :282.
 * - PTC mode: \`tool/ptc-dispatch-start\` and \`tool/ptc-dispatch\` (with
 *   \`subCallId\`), the write sites being core/tools/src/ptc.ts:534 and :509.
 *
 * A consumer that matches a vocabulary directly therefore goes blind in the
 * other mode while still appearing to work — the defect this module exists to
 * make impossible. Every family consumer reads dispatches through
 * \`ToolDispatchNormalizer\` (or the pure helpers below) and matches on
 * \`ToolDispatchSignal\` fields only; \`verify-arch-guards\` rule N11 rejects a
 * dispatch event-type comparison anywhere else.
 *
 * ## The one-dispatch invariant
 *
 * One dispatch produces exactly one \`ToolDispatchSignal\`, no matter how many
 * events carry it: a start/settle pair for a PTC sub-dispatch, a call/result
 * pair for a native call, or both vocabularies for the same call. Deduplication
 * and outcome folding are keyed by the platform's own per-vocabulary call
 * identity, which is stable across the pair (the platform's event JSDoc:
 * "the pairing ids (matching the \`tool/ptc-dispatch-start\` with the same
 * \`subCallId\`)").
 *
 * ## Layer
 *
 * Cross-cutting normalization: the reader half of the dispatch vocabulary,
 * next to \`signals.ts\` (which folds the signals this module emits). Both are
 * consumers; neither subscribes to the platform bus itself.
 * @module
 */

/** How the platform delivered one dispatch. */
export type ToolDispatchKind =
  /** A model-authored call, logged as \`tool/call\` and settled by \`tool/result\`. */
  | 'native'
  /** A sub-dispatch of a code program, logged as the PTC dispatch pair. */
  | 'program'
  /** A \`run_code\` call itself: a native call whose program dispatches sub-calls. */
  | 'program-root'

/** The platform event type carrying a PTC sub-dispatch start. */
export const PTC_DISPATCH_START_EVENT = 'tool/ptc-dispatch-start'
/** The platform event type carrying a PTC sub-dispatch settle. */
export const PTC_DISPATCH_EVENT = 'tool/ptc-dispatch'
/** The platform event type carrying a native tool call. */
export const NATIVE_CALL_EVENT = 'tool/call'
/** The platform event type carrying a native tool result. */
export const NATIVE_RESULT_EVENT = 'tool/result'

/**
 * The dispatch vocabulary this module owns. A consumer must never compare
 * against these literals itself (rule N11); it compares \`kind\` instead.
 */
export const DISPATCH_EVENT_TYPES: readonly string[] = [
  NATIVE_CALL_EVENT,
  NATIVE_RESULT_EVENT,
  PTC_DISPATCH_START_EVENT,
  PTC_DISPATCH_EVENT,
]

/**
 * One normalized tool dispatch.
 *
 * Every field is derived from a platform event payload; the record is mutable
 * and is updated in place when a later event of the same dispatch settles it,
 * so a consumer that reacted at start already holds the outcome.
 */
export interface ToolDispatchSignal {
  /** \`native\` | \`program\` (a code-program sub-dispatch) | \`program-root\` (the \`run_code\` call itself). */
  readonly kind: ToolDispatchKind
  /** \`callId\` for a native call, \`subCallId\` for a PTC sub-dispatch — the platform's own identity. */
  readonly callId: string
  /** The outer call: \`parentCallId\` for a PTC sub-dispatch, the call's own id for a native call. */
  readonly rootCallId: string
  /** Dispatched tool name, always a non-empty string. */
  readonly name: string
  /** Arguments as dispatched: a JSON string in native mode, the normalized object in PTC mode. */
  readonly arguments: unknown
  /** Settled outcome: \`true\` succeeded, \`false\` failed, \`undefined\` still in flight. */
  ok: boolean | undefined
}

/**
 * \`TypeError\` thrown when a payload that claims to be a dispatch event
 * violates the platform's event declaration. Named so a deployment can tell this
 * refusal apart from a generic failure in a log line.
 */
export class ToolDispatchPayloadError extends TypeError {
  override name = 'ToolDispatchPayloadError'
}

/** The dispatch event types this module recognizes, as a set. */
const DISPATCH_EVENT_TYPE_SET = new Set(DISPATCH_EVENT_TYPES)
/** \`name\`-less payloads: an external emitter or a corrupt log can produce these. */
const MALFORMED = 'malformed'

/** One payload read out of a session event, with its own vocabulary already applied. */
interface DispatchRecord {
  kind: ToolDispatchKind
  callId: string
  rootCallId: string
  name: string
  arguments: unknown
  /** Present only when the event settles a dispatch. */
  outcome?: { ok: boolean }
}

/** One tool-result block of a native result payload, or \`null\` when the payload carries none. */
function firstResultBlock(data: { message?: { content?: unknown } }): { isError?: unknown; toolCallId?: unknown } | null {
  const content = data.message?.content
  if (!Array.isArray(content)) return null
  for (const entry of content) {
    if (entry === null || typeof entry !== 'object') continue
    const block = entry as { type?: unknown; isError?: unknown; toolCallId?: unknown }
    if (block.type === 'tool-result') return block
  }
  return null
}

/** Deterministic identity for a dispatch payload that carries no call id. */
function payloadIdentity(data: unknown): string {
  if (data === undefined) return ''
  try {
    return JSON.stringify(data)
  } catch {
    // A cyclic payload cannot be identified by value; the event TYPE is then the
    // whole identity, so two undecidable frames collapse into one rather than
    // inflating the count. The refusal is loud at the live boundary
    // (`assertDispatchPayload`), which is where a producer bug is actionable.
    return ''
  }
}

/** Read the payload of a recognized dispatch event, or \`null\` for any other event. */
function readDispatchRecord(event: { type: string; data?: unknown }): DispatchRecord | null {
  if (!DISPATCH_EVENT_TYPE_SET.has(event.type)) return null
  const data = (event.data ?? {}) as {
    callId?: unknown
    subCallId?: unknown
    parentCallId?: unknown
    rootCallId?: unknown
    name?: unknown
    arguments?: unknown
    isError?: unknown
    error?: unknown
    message?: { source?: { callId?: unknown }; content?: unknown }
  }
  if (event.type === NATIVE_RESULT_EVENT) {
    // The call identity lives INSIDE the message (`message.source.callId`, the
    // shape `createToolResultMessage` produces — llm/src/message.ts:258); the
    // event payload has no top-level `callId`. A `toolCallId` on a result block
    // is accepted as the same identity for a hand-built or legacy frame.
    const owner = data.message?.source?.callId
    const block = firstResultBlock(data)
    const callId = typeof owner === 'string' && owner !== ''
      ? owner
      : typeof block?.toolCallId === 'string' && block.toolCallId !== '' ? block.toolCallId : undefined
    if (callId === undefined) return null
    return {
      kind: 'native',
      callId,
      rootCallId: callId,
      name: '',
      arguments: undefined,
      // A failure is marked by the payload-level `error` OR a result block's own
      // `isError` (both shapes exist in persisted pre-rc.2 logs).
      outcome: { ok: data.isError !== true && data.error === undefined && block?.isError !== true },
    }
  }
  const isPtc = event.type === PTC_DISPATCH_START_EVENT || event.type === PTC_DISPATCH_EVENT
  const identity = isPtc ? data.subCallId : data.callId
  // An id-less payload is still evidence of a call the model made: a real log
  // always carries the id, but a replayed pre-upgrade frame or an external
  // emitter may not, and dropping those would silently under-count. The
  // payload itself becomes the identity, so the same broken frame delivered
  // twice is still ONE dispatch.
  const callId = typeof identity === 'string' && identity !== '' ? identity : `${event.type}:${payloadIdentity(event.data)}`
  const parent = isPtc && typeof data.parentCallId === 'string' && data.parentCallId !== '' ? data.parentCallId : undefined
  const name = typeof data.name === 'string' && data.name !== '' ? data.name : MALFORMED
  return {
    kind: isPtc ? 'program' : 'native',
    callId,
    rootCallId: typeof data.rootCallId === 'string' && data.rootCallId !== '' ? data.rootCallId : (parent ?? callId),
    name,
    arguments: data.arguments,
    ...isPtc && event.type === PTC_DISPATCH_EVENT ? { outcome: { ok: data.isError !== true } } : {},
  }
}

/**
 * The family's single dispatch ledger: absorbs platform events in log order,
 * emits one \`ToolDispatchSignal\` per dispatch, and folds later events of the
 * same dispatch into the record it already emitted.
 *
 * Consumers keep the \`ToolDispatchSignal\` object they received and re-read it
 * later; no consumer needs to correlate events itself.
 */
export class ToolDispatchNormalizer {
  private readonly records = new Map<string, ToolDispatchSignal>()
  /** Call ids of \`run_code\`-class calls, i.e. of dispatches whose sub-dispatches are \`program\`. */
  private readonly programRoots = new Set<string>()

  /**
   * Absorb one session event.
   * @param event - the event to absorb; any non-dispatch event is ignored.
   * @returns the dispatch's signal when this event FIRST reveals the dispatch,
   * otherwise \`null\` (the paired event of an already-emitted dispatch, or a
   * non-dispatch event). A \`null\` return is never a dispatch to count again.
   */
  advance(event: { type: string; data?: unknown }): ToolDispatchSignal | null {
    const record = readDispatchRecord(event)
    if (record === null) return null
    if (record.name === '') {
      const existing = this.records.get(record.callId)
      if (existing !== undefined && record.outcome !== undefined) existing.ok = record.outcome.ok
      return null
    }
    const existing = this.records.get(record.callId)
    if (existing !== undefined) {
      if (record.outcome !== undefined) existing.ok = record.outcome.ok
      return null
    }
    const signal: ToolDispatchSignal = {
      kind: record.kind === 'native' && this.programRoots.has(record.callId) ? 'program-root' : record.kind,
      callId: record.callId,
      rootCallId: record.rootCallId,
      name: record.name,
      arguments: record.arguments,
      ok: record.outcome?.ok,
    }
    this.records.set(record.callId, signal)
    // A PTC sub-dispatch proves its parent is a program root: the platform logs
    // these events only inside a \`run_code\` execution (ptc.ts bridge).
    if (record.kind === 'program' && record.rootCallId !== record.callId) this.programRoots.add(record.rootCallId)
    return signal
  }

  /** Every emitted dispatch, in first-seen order. */
  get signals(): readonly ToolDispatchSignal[] {
    return [...this.records.values()]
  }

  /**
   * Fold every event of a session log, in order.
   * @param events - the log, oldest first.
   * @returns one signal per dispatch, in first-seen order.
   */
  foldAll(events: Iterable<{ type: string; data?: unknown }>): ToolDispatchSignal[] {
    const emitted: ToolDispatchSignal[] = []
    for (const event of events) {
      const signal = this.advance(event)
      if (signal !== null) emitted.push(signal)
    }
    return emitted
  }
}

/**
 * Read one event into a dispatch record without a ledger (the pure half of the
 * fold). Unlike the ledger it does NOT dedupe: a caller that walks a log and
 * emits its own lines needs the call line on the event that opens the result.
 * @param event - one session event; an absent event (an over-advanced index)
 * answers \`null\` rather than throwing.
 * @returns the dispatch this event opens, or \`null\` for any other event.
 */
export function readDispatchSignal(event: {
  type?: string
  data?: unknown
} | undefined): { kind: ToolDispatchKind; callId: string; rootCallId: string; name: string; arguments: unknown } | null {
  if (event?.type === undefined) return null
  const record = readDispatchRecord({ type: event.type, ...event.data === undefined ? {} : { data: event.data } })
  if (record === null || record.name === '') return null
  return {
    kind: record.kind,
    callId: record.callId,
    rootCallId: record.rootCallId,
    name: record.name,
    arguments: record.arguments,
  }
}

/** Tool names that READ one skill. The single authority for skill-read detection. */
const SKILL_READ_TOOL_NAMES = new Set(['skill'])

/**
 * Is this dispatched tool name a single-skill read?
 * @param name - the dispatched tool name.
 * @returns \`true\` only for the read tool whose arguments name one skill.
 */
export function isSkillReadToolName(name: string): boolean {
  return SKILL_READ_TOOL_NAMES.has(name)
}

/** Tool names whose dispatch opens a code program, i.e. whose sub-dispatches are \`program\`. */
const PROGRAM_TOOL_NAMES = new Set(['run_code'])

/**
 * Does this signal read one skill, and did it not fail?
 * @param signal - a normalized dispatch.
 * @returns the skill name the dispatch read, or \`undefined\` when the dispatch
 * is not a skill read or has failed. A dispatch whose outcome is still pending
 * counts as a read: the platform settles every started sub-dispatch, so pending
 * is a live-window state, not a failure.
 */
export function skillReadNameOf(signal: ToolDispatchSignal): string | undefined {
  if (!SKILL_READ_TOOL_NAMES.has(signal.name)) return undefined
  if (signal.ok === false) return undefined
  // The arguments are a JSON string in native mode and an already-parsed object
  // in PTC mode (core/tools/src/types.ts:11-23), so re-parse defensively rather
  // than trust one modality's encoding.
  let parsed: unknown = signal.arguments
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown
    } catch {
      return undefined
    }
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
  const candidate = parsed as Record<string, unknown>
  const name = typeof candidate.name === 'string' ? candidate.name : typeof candidate.skill === 'string' ? candidate.skill : ''
  return name === '' ? undefined : name
}

/**
 * Fold one session log into its deduplicated dispatches.
 * @param events - the log, oldest first. Pass an array, not a live snapshot
 * iterator, when the log can grow while folding.
 * @returns one signal per dispatch, in first-seen order.
 */
export function foldToolDispatches(events: Iterable<{ type: string; data?: unknown }>): ToolDispatchSignal[] {
  return new ToolDispatchNormalizer().foldAll(events)
}

/**
 * Every skill name this log read through a dispatch, deduplicated by dispatch.
 * @param events - the log, oldest first.
 * @returns the names read by at least one non-failed skill dispatch.
 */
export function collectReadSkillNames(events: Iterable<{ type: string; data?: unknown }>): Set<string> {
  const names = new Set<string>()
  for (const signal of foldToolDispatches(events)) {
    const name = skillReadNameOf(signal)
    if (name !== undefined) names.add(name)
  }
  return names
}

/** Tool names that touch the skill library at all — the review's skill-signal set. */
const SKILL_TOOL_NAMES = new Set([...SKILL_READ_TOOL_NAMES, 'skill_manage'])

/**
 * Does this dispatched tool name touch the skill library (read or mutate)?
 * @param name - the dispatched tool name.
 * @returns \`true\` for any skill-library tool. This is the review cadence's
 * skill signal, which has always covered reads and writes alike.
 */
export function isSkillToolName(name: string): boolean {
  return SKILL_TOOL_NAMES.has(name)
}

/**
 * Does this dispatched tool name open a code program?
 * @param name - the dispatched tool name.
 * @returns \`true\` for the tool whose sub-dispatches are \`program\` kind.
 */
export function isProgramToolName(name: string): boolean {
  return PROGRAM_TOOL_NAMES.has(name)
}

/**
 * Assert that a payload really is the dispatch event it claims to be.
 *
 * The normalizer is deliberately lenient (it also folds persisted logs, where a
 * payload may predate the current declaration); this is the loud gate for the
 * live path, where a malformed payload means the producer is broken. It never
 * silently downgrades: an unrecognized event type or a payload missing a
 * declared field throws a named \`ToolDispatchPayloadError\`.
 * @param event - the session event to check.
 * @returns nothing; throws when the payload violates the platform declaration.
 */
export function assertDispatchPayload(event: { type: string; data?: unknown }): void {
  const data = (event.data ?? {}) as Record<string, unknown>
  if (event.type === NATIVE_CALL_EVENT) {
    if (typeof data.name !== 'string' || data.name === '' || typeof data.callId !== 'string' || data.callId === '') {
      throw new ToolDispatchPayloadError('tool/call carries no name/callId: the agent-loop write site is broken')
    }
    return
  }
  if (event.type === PTC_DISPATCH_START_EVENT || event.type === PTC_DISPATCH_EVENT) {
    if (typeof data.subCallId !== 'string' || data.subCallId === '' || typeof data.name !== 'string' || data.name === '') {
      throw new ToolDispatchPayloadError(`${event.type} carries no name/subCallId: the PTC bridge write site is broken`)
    }
    if (event.type === PTC_DISPATCH_EVENT && typeof data.isError !== 'boolean') {
      throw new ToolDispatchPayloadError('tool/ptc-dispatch carries no boolean isError: the settle outcome is unusable')
    }
    return
  }
  if (event.type === NATIVE_RESULT_EVENT) return
  throw new ToolDispatchPayloadError(`${event.type} is not a platform dispatch event; compare signal.kind instead of event types`)
}

/**
 * Total dispatches in a log, deduplicated.
 * @param events - the log, oldest first.
 * @returns the number of distinct dispatches, one per dispatch regardless of
 * how many events carried it.
 */
export function countDispatches(events: Iterable<{ type: string; data?: unknown }>): number {
  return foldToolDispatches(events).length
}
