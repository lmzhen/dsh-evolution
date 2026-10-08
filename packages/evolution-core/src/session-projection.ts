/**
 * The family's session projections: the per-session facts the family used to re-read the log for.
 *
 * 0.2.x deprecates the synchronous log reads (`Session.snapshotEvents` — "existing logic may
 * remain unmigrated for now, but new calls are prohibited",
 * `core/session/src/index.ts:639-658`) and drives DOMAIN-OWNED units instead: a registered unit
 * folds every committed event once, the registry owns the subscription and the per-session
 * watermark, and a reader asks for the current state
 * (`session/session-projection/src/index.ts` — `register`/`stateOf`). Each unit here carries
 * exactly what one pure family reader derives from a log, so that reader keeps its pure form and
 * gains a projection-backed one beside it.
 *
 * State stays bounded. The evidence unit keeps the SPARSE boundary seqs and answers the dense
 * question by complement: a content-seq set grows with every session event, while a turn/step
 * boundary set grows four entries per turn.
 *
 * The registry is part of the platform's BASE bundle (`packages/bundle/base/cordis.patch.yml:158`),
 * so a real host always has it; a composition without it keeps loading (`ctx.inject` probe) and
 * its readers report "cannot classify" instead of guessing — the same posture the pure readers
 * document for a log with no seq.
 * @module @deepseek-ai/dsh-evolution-core
 */
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { isBookkeepingFrame, type EvidenceIndex } from './evidence.ts'
import { dispatchStepOf, isSkillReadToolName, skillReadNameOf } from './tool-dispatch.ts'
import { foldTurnEvent, initialTurnFold, type TurnFoldState, type TurnSignals } from './signals.ts'

/** Time of the newest event folded for one session; 0 for a log with no event. */
export interface EvolutionActivityState {
  /** Milliseconds of the newest event, or 0 when nothing was folded. */
  readonly lastEventTime: number
}

/**
 * Which session frames carry content, in complement form.
 *
 * `sequenced` counts the frames that carry an integer seq, so 0 is the "this log cannot tell a
 * boundary from a message" answer the evidence reader reports as `undefined` (a stub session, a
 * log whose events carry no seq).
 *
 * `through` is the highest seq folded, so a citation BEYOND the log answers false exactly as the
 * dense set does. Platform logs number their frames densely from 0 (a seq is a frame's index), so
 * complement and enumeration agree; a sparse hand-built log is not a Session and reaches the unit
 * through neither path.
 */
export interface EvolutionEvidenceState {
  /** Frames folded that carried an integer seq. */
  readonly sequenced: number
  /** Highest seq folded; -1 before the first sequenced frame. */
  readonly through: number
  /** Boundary seqs, ascending. Every other seq at or below `through` carries content. */
  readonly bookkeeping: readonly number[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** The curator's idleness gate input: the newest event time of one session. */
    evolutionActivity: EvolutionActivityState
    /** The plan path's evidence-class input: the boundary seqs of one session. */
    evolutionEvidence: EvolutionEvidenceState
  }
}

// Bounds are the persisted-row validation bounds (a millisecond timestamp): the clamp guard
// requires every `z.number()` field to carry one on the same line.
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000
const activityStateSchema = z.object({ lastEventTime: z.number().nonnegative().max(MAX_TIMESTAMP_MS) }).strict()

const evidenceStateSchema = z.object({
  sequenced: z.number().int().nonnegative(),
  through: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER),
  bookkeeping: z.array(z.number().int().nonnegative()),
}).strict()

/** The `evolutionActivity` unit (host-only: no client view is registered for it). */
export const evolutionActivityProjection: ProjectionDefinition<'evolutionActivity'> = {
  key: 'evolutionActivity',
  stateVersion: 1,
  stateSchema: activityStateSchema,
  init: () => ({ lastEventTime: 0 }),
  apply: (state, event) => {
    const time = typeof event.time === 'number' ? event.time : state.lastEventTime
    // Same reference when the event repeats the previous millisecond: the change feed keys on
    // `Object.is`, and an unchanged reference produces zero downstream work.
    return time === state.lastEventTime ? state : { lastEventTime: time }
  },
}

/** The `evolutionEvidence` unit (host-only: no client view is registered for it). */
export const evolutionEvidenceProjection: ProjectionDefinition<'evolutionEvidence'> = {
  key: 'evolutionEvidence',
  stateVersion: 1,
  stateSchema: evidenceStateSchema,
  init: () => ({ sequenced: 0, through: -1, bookkeeping: [] }),
  apply: (state, event) => {
    const seq = event.seq
    // Only an integer seq is citable, so only an integer seq is classifiable (the same test the
    // pure reader makes).
    if (typeof seq !== 'number' || !Number.isInteger(seq)) return state
    const sequenced = state.sequenced + 1
    const through = seq > state.through ? seq : state.through
    if (typeof event.type !== 'string' || !isBookkeepingFrame(event.type)) {
      return { sequenced, through, bookkeeping: state.bookkeeping }
    }
    return { sequenced, through, bookkeeping: [...state.bookkeeping, seq] }
  },
}

/**
 * Whether one session object can be projected at all.
 *
 * The family's readers also take STRUCTURAL session views — `skill-reads.ts` documents the tool
 * path's bare stub — while the registry folds a session's own log (`snapshotEvents(from, to)`,
 * `eventAt(seq)`, `seq`, `inheritedEventCount`) whenever it has to build or advance a cell. A
 * view without those members has no projection state to read, and asking for one would fold a
 * log the unit cannot index.
 * @param session - the value a caller holds as its session.
 * @returns true when the registry can fold this object.
 */
function isProjectableSession(session: unknown): session is Session {
  if (session === null || typeof session !== 'object') return false
  const candidate = session as Partial<Session>
  // The two accessors are named on purpose: they ARE the fold contract the registry needs, and
  // this probe only answers whether the object carries them — it reads no session history.
  // oxlint-disable-next-line typescript/no-deprecated -- capability probe, not a history read
  const folds = typeof candidate.eventAt === 'function'
  // oxlint-disable-next-line typescript/no-deprecated -- capability probe, not a history read
  const logs = typeof candidate.snapshotEvents === 'function'
  return folds && logs && typeof candidate.seq === 'number'
}

/**
 * The skill names one session read through a non-failed dispatch, as a fold state.
 *
 * One entry per READ-CAPABLE dispatch (`isSkillReadToolName`), in first-seen order: the ledger
 * key, the skill the arguments name (null when they name none), and whether a settle failed it.
 * A pending dispatch counts as read — the platform settles every started sub-dispatch, so pending
 * is a live-window state, not a failure (`skillReadNameOf` documents the same rule).
 */
export interface EvolutionReadsState {
  /** Read dispatches seen so far, in first-seen order. */
  readonly reads: readonly { readonly key: string; readonly skill: string | null; readonly failed: boolean }[]
}

/**
 * The current turn's window signals plus the facts a turn boundary needs.
 *
 * `turn` is the SAME state `foldTurnEvent` folds for `observeEvent`; it resets at `turn/start`, so
 * the state after the newest event is exactly the window `foldTurn(session, turnStartSeq)` reads.
 * `through`/`lastEventTime` serve readers that only need progress (the curator's idleness gate has
 * its own unit, but a consumer holding this one gets the same answers).
 */
export interface EvolutionSignalsState {
  /** Seq of the last folded event; -1 before the first. */
  readonly through: number
  /** Time of the last folded event; 0 before the first. */
  readonly lastEventTime: number
  /** Seq of the open turn's `turn/start`; -1 when none was seen. */
  readonly turnStartSeq: number
  /** The open turn's window fold. */
  readonly turn: TurnFoldState
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** The skill names one session read, for the read-before-write gate and the review plan path. */
    evolutionReads: EvolutionReadsState
    /** The open turn's window signals, for the review cadence. */
    evolutionSignals: EvolutionSignalsState
  }
}

const readsStateSchema = z.object({
  reads: z.array(z.object({
    key: z.string(),
    skill: z.string().nullable(),
    failed: z.boolean(),
  }).strict()),
}).strict()

const signalsStateSchema = z.object({
  through: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER),
  lastEventTime: z.number().nonnegative().max(MAX_TIMESTAMP_MS),
  turnStartSeq: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER),
  turn: z.object({
    substantive: z.boolean(),
    toolCalls: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    userChars: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    assistantChars: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    memorySignal: z.boolean(),
    skillSignal: z.boolean(),
    opened: z.array(z.string()),
  }).strict(),
}).strict()

/** The `evolutionReads` unit (host-only: no client view is registered for it). */
export const evolutionReadsProjection: ProjectionDefinition<'evolutionReads'> = {
  key: 'evolutionReads',
  stateVersion: 1,
  stateSchema: readsStateSchema,
  init: () => ({ reads: [] }),
  apply: (state, event) => {
    const frame: { type: string; data?: unknown } = event
    const step = dispatchStepOf(frame)
    if (step === null) return state
    const at = state.reads.findIndex(entry => entry.key === step.key)
    // An event with no name only SETTLES a dispatch: it can flip the failure flag of one already
    // tracked, and a dispatch this fold never saw open has nothing to record.
    // One settle-or-replay transition, shared by both branches below: only a tracked dispatch with
    // a carried outcome moves, and only when the flag actually changes.
    const settled = (): EvolutionReadsState => {
      const entry = at < 0 ? undefined : state.reads[at]
      if (entry === undefined || step.outcome === undefined) return state
      const failed = !step.outcome.ok
      if (entry.failed === failed) return state
      const reads = [...state.reads]
      reads[at] = { key: entry.key, skill: entry.skill, failed }
      return { reads }
    }
    // An event with no name only SETTLES a dispatch: it can flip the failure flag of one already
    // tracked, and a dispatch this fold never saw open has nothing to record.
    if (step.name === '') return settled()
    // A replayed open of a tracked dispatch: keep the first entry, still honour its outcome.
    if (at >= 0) return settled()
    // Only a read-capable tool is worth a state entry: the reader answers skill names, and a
    // state that tracked every dispatch would grow with the session.
    if (!isSkillReadToolName(step.name)) return state
    const skill = skillReadNameOf({
      kind: step.kind,
      callId: step.callId,
      rootCallId: step.rootCallId,
      name: step.name,
      arguments: step.arguments,
      ok: step.outcome?.ok,
    }) ?? null
    return { reads: [...state.reads, { key: step.key, skill, failed: step.outcome?.ok === false }] }
  },
}

/** The `evolutionSignals` unit (host-only: no client view is registered for it). */
export const evolutionSignalsProjection: ProjectionDefinition<'evolutionSignals'> = {
  key: 'evolutionSignals',
  stateVersion: 1,
  stateSchema: signalsStateSchema,
  init: () => ({ through: -1, lastEventTime: 0, turnStartSeq: -1, turn: initialTurnFold() }),
  apply: (state, event) => {
    const start = event.type === 'turn/start'
    const turn = foldTurnEvent(start ? initialTurnFold() : state.turn, event)
    const seq = typeof event.seq === 'number' && Number.isInteger(event.seq) ? event.seq : state.through
    const time = typeof event.time === 'number' ? event.time : state.lastEventTime
    const turnStartSeq = start ? seq : state.turnStartSeq
    if (turn === state.turn && seq === state.through && time === state.lastEventTime && turnStartSeq === state.turnStartSeq) return state
    return { through: seq, lastEventTime: time, turnStartSeq, turn }
  },
}

/**
 * Register the family's units on the calling context's fiber.
 *
 * Called by the READERS (not by a plugin's mount) and idempotent by the registry's own reference
 * count: the first read of a foldable session installs the definitions, later reads count as
 * co-owners, and the keys survive until the last registrant unloads
 * (`session-projection/src/index.ts:273-292`). Registering at the read is what keeps a session
 * view the registry cannot fold (`isProjectableSession`) from ever reaching its drive — the
 * registry folds the in-memory log on first touch, so a unit that appears mid-session is still
 * correct (`:602-630`).
 *
 * Idempotent by design, so a plugin mounting later does not need its own call.
 * @param ctx - the mounting plugin's context.
 */
export function installEvolutionProjections(ctx: Context): void {
  const register = (registry: Context['sessionProjections']): void => {
    registry.register(evolutionActivityProjection)
    registry.register(evolutionEvidenceProjection)
    registry.register(evolutionReadsProjection)
    registry.register(evolutionSignalsProjection)
  }
  // Already-mounted registry first: a reader that runs in the same tick as its own mount
  // (a unit spec, an assembly-time probe) must see its units registered, and the injected
  // callback of a not-yet-available service is not guaranteed to have run by then.
  const mounted = ctx.get('sessionProjections')
  if (mounted !== undefined) {
    register(mounted)
    return
  }
  ctx.inject(['sessionProjections'], (injected) => { register(injected.sessionProjections) })
}

/**
 * Time of one session's newest event, or `undefined` when the unit is not installed.
 *
 * The curator's idleness gate reads this instead of folding the session log; `undefined` is a
 * measurement that did not happen, which the gate answers with the deployment's fail-open policy.
 * @param ctx - a context of the runtime (the service is read from the global store).
 * @param session - the session to ask about.
 * @returns the newest event's milliseconds, or undefined with no unit or no event.
 */
export function sessionLastEventTime(ctx: Context, session: Session): number | undefined {
  if (!isProjectableSession(session)) return undefined
  installEvolutionProjections(ctx)
  const state = ctx.get('sessionProjections')?.stateOf(session, 'evolutionActivity')
  if (state === undefined || state.lastEventTime === 0) return undefined
  return state.lastEventTime
}

/**
 * The skill names one session read through a non-failed dispatch, or `undefined` when the session
 * cannot be projected (a structural view, or a host without the registry).
 *
 * `undefined` is NOT an empty set: the tool path's read-before-write gate keeps its previous
 * behavior rather than refusing every write in a composition whose session object is a bare stub
 * (`skill-reads.ts` documents that three-state posture).
 * @param ctx - a context of the runtime.
 * @param session - the session whose reads are wanted.
 * @returns the names read, or undefined when the log cannot be folded.
 */
export function sessionReadNames(ctx: Context, session: Session): ReadonlySet<string> | undefined {
  if (!isProjectableSession(session)) return undefined
  installEvolutionProjections(ctx)
  const state = ctx.get('sessionProjections')?.stateOf(session, 'evolutionReads')
  if (state === undefined) return undefined
  const names = new Set<string>()
  for (const entry of state.reads) {
    if (!entry.failed && entry.skill !== null) names.add(entry.skill)
  }
  return names
}

/**
 * The open turn's window signals, or `undefined` when the session cannot be projected.
 *
 * The window is the events since the newest `turn/start`, folded by the same `foldTurnEvent`
 * `observeEvent` uses; `undefined` means the caller has no measurement (a structural view), not
 * that the turn was empty.
 * @param ctx - a context of the runtime.
 * @param session - the session whose open turn is being judged.
 * @returns the window signals, or undefined when the log cannot be folded.
 */
export function sessionTurnSignals(ctx: Context, session: Session): TurnSignals | undefined {
  if (!isProjectableSession(session)) return undefined
  installEvolutionProjections(ctx)
  const state = ctx.get('sessionProjections')?.stateOf(session, 'evolutionSignals')
  if (state === undefined) return undefined
  const { substantive, toolCalls, userChars, assistantChars, memorySignal, skillSignal } = state.turn
  return { substantive, toolCalls, userChars, assistantChars, memorySignal, skillSignal }
}

/**
 * The evidence index of one session, or `undefined` when the log cannot be classified.
 *
 * `undefined` covers both the missing unit and a log whose frames carry no seq: the plan path's
 * `EVIDENCE_CLASS` row is report-only and must stay silent rather than report every op.
 * @param ctx - a context of the runtime.
 * @param session - the session the review plan is authored against.
 * @returns an index answering "does this seq carry content?".
 */
export function sessionEvidenceIndex(ctx: Context, session: Session): EvidenceIndex | undefined {
  if (!isProjectableSession(session)) return undefined
  installEvolutionProjections(ctx)
  const state = ctx.get('sessionProjections')?.stateOf(session, 'evolutionEvidence')
  if (state === undefined || state.sequenced === 0) return undefined
  const { through, bookkeeping } = state
  return {
    has: (seq: number): boolean => Number.isInteger(seq) && seq >= 0 && seq <= through && !bookkeeping.includes(seq),
  }
}
