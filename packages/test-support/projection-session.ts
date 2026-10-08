/**
 * A PROJECTABLE session stub for family specs that drive a pipeline by hand.
 *
 * The platform's projection registry (G4 in the family's 0.2.x adaptation) folds a session's own
 * log whenever it builds or advances a cell: it calls `snapshotEvents(from, to)`, indexes with
 * `eventAt(seq)`, and steps from one seq to the next. A hand-built stub with a bare
 * `snapshotEvents: () => [...]` and no seqs therefore makes the registry's drive throw
 * (`SessionLogOffset`/`SessionSeq` reject undefined/NaN), and a stub whose announced `seq`
 * disagrees with its log cannot be advanced at all.
 *
 * This module gives such a stub the members the registry needs and one way to append:
 * `projectable(stub)` keeps the log dense and seq-stamped (seq = index, `session.seq` = length),
 * and `emitSessionEvent(ctx, session, type, data)` appends and announces the event the way a real
 * append does. Specs that assert review/curator behavior should use it instead of emitting
 * `session/event` by hand — a production reader that cannot measure reports "cannot classify" and
 * the pipeline deliberately does nothing.
 * @module @deepseek-ai/dsh-evolution/test-support/projection-session
 */
import type { Context } from '@deepseek-ai/cordis'

/** One event of a stub session's log. */
export interface StubSessionEvent {
  readonly type: string
  /** The frame's index in the log; the registry indexes by it. */
  readonly seq: number
  readonly time: number
  readonly data?: unknown
}

/** The stub shape this decorator accepts (any object literal a spec already builds). */
interface StubLike {
  snapshotEvents?: () => readonly Record<string, unknown>[]
}

/** Per-stub logs, so the decorator never adds enumerable state a spec's assertions might see. */
const logs = new WeakMap<object, StubSessionEvent[]>()

/** The seq-stamped log of one decorated stub (empty for an undecorated object). */
export function stubLog(session: object): readonly StubSessionEvent[] {
  return logs.get(session) ?? []
}

/**
 * Make a hand-built session stub foldable by the projection registry.
 *
 * In place: the log is seq-stamped from 0, `session.seq` becomes the log's length, and
 * `snapshotEvents(from, to)` / `eventAt(seq)` / `inheritedEventCount` answer the registry's
 * contract. Everything else the stub carries (`id`, `header`, `deriveMessages`, inbox views) is
 * left untouched.
 * @param stub - the spec's session literal.
 * @returns the same object, now projectable.
 */
export function projectable<T extends StubLike>(stub: T): T {
  const log: StubSessionEvent[] = (stub.snapshotEvents?.() ?? []).map((event, index) => ({
    // A frame without a string `type` folds as "nothing this family reads", which is what an
    // unknown platform type does too — the decorator never invents a type for it.
    type: typeof event['type'] === 'string' ? event['type'] : '',
    seq: index,
    time: typeof event['time'] === 'number' ? event['time'] : Date.now(),
    ...event['data'] === undefined ? {} : { data: event['data'] },
  }))
  logs.set(stub, log)
  const target = stub as unknown as Record<string, unknown>
  // The announced seq IS the log length: the registry advances from one seq to the next, so a stub
  // whose seq disagrees with its log is exactly the shape it cannot fold.
  Object.defineProperty(target, 'seq', { get: () => log.length, configurable: true, enumerable: true })
  target['inheritedEventCount'] = 0
  target['snapshotEvents'] = (from = 0, to = log.length) => log.slice(from, to)
  target['eventAt'] = (seq: number) => log[seq]
  // The same object, back under the caller's own type: the decorator only adds members.
  return stub
}

/**
 * Append one event to a decorated stub's log and announce it — the two halves of a real append.
 * @param ctx - the spec's context (the registry listens on `session/event`).
 * @param session - a session built with {@link projectable}.
 * @param type - the platform event type.
 * @param data - the event payload, when it has one.
 */
export function emitSessionEvent(ctx: Context, session: object, type: string, data?: unknown): void {
  const log = logs.get(session)
  if (log === undefined) throw new Error('emitSessionEvent: build the session with projectable() first')
  const event: StubSessionEvent = { type, seq: log.length, time: Date.now(), ...data === undefined ? {} : { data } }
  log.push(event)
  ;(ctx.emit as (name: string, session: unknown, event: unknown) => void)('session/event', session, event)
}

/**
 * Announce one whole turn the way the loop does: its boundary, one substantive tool call, its end.
 *
 * Every hand-driven review spec narrates the same three frames (the boundary opens the window the
 * cadence folds, the tool call makes it substantive, the end fires the pipeline), so they live here
 * once instead of in each fixture.
 *
 * The call's EVENT TYPE is a parameter on purpose: the family's dispatch vocabulary is owned by
 * `evolution-core/src/tool-dispatch.ts` (its arch guard rejects any other module naming those
 * types), so the caller — a spec file — passes the constant it imported from the vocabulary.
 * @param ctx - the spec's context.
 * @param session - a session built with {@link projectable}.
 * @param turn - the turn number.
 * @param callEventType - the logged tool-call event type (`NATIVE_CALL_EVENT` for a native call).
 * @param reasonKind - the turn's end reason.
 */
export function emitTurnBoundary(
  ctx: Context,
  session: object,
  turn: number,
  callEventType: string,
  reasonKind: 'completed' | 'blocked' = 'completed',
): void {
  emitSessionEvent(ctx, session, 'turn/start', { turn })
  emitSessionEvent(ctx, session, callEventType, { turn, step: 2, callId: 'c' + String(turn), name: 'skill', arguments: '{}' })
  emitSessionEvent(ctx, session, 'turn/end', { turn, reason: { kind: reasonKind } })
}
