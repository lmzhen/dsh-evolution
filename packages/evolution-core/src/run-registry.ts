/**
 * 0.19.0 (S2) / 0.19.3 (restructure): the family's run-lifecycle owner.
 *
 * A "run" is work that can outlive one interaction — today the maintenance scan.
 * Before this module the only record of such work was the requesting invocation:
 * `lastMaintainAt` / `lastMaintainRunId` / `maintainInFlightSince` were
 * module-scope globals in evolution-commands, and the plan text existed ONLY in
 * the command's return string. An interaction that ended (measured: the desktop
 * shell hangs up at ~305 s) therefore erased every trace of a still-running scan.
 *
 * This registry is the single owner of (a) what is in flight, (b) how a run
 * ended, and (c) WHERE its result lives (`resultRef` is a path, never the result
 * itself — the report file is the one result home).
 *
 * Three disciplines are structural, not stylistic:
 *
 *   - **One writer per row** (0.19.3). A run's row is authoritative in the memory of
 *     the process that STARTED it (`owned`) and in the shared index for everyone else
 *     (`foreign`, rebuilt from the file on every `load()`). The only write a non-owner
 *     may make is the orphan verdict for a row whose owner is gone, judged inside the
 *     very transaction that read the row. The two cross-plane bugs this family shipped
 *     were projections of that one missing rule: 0.19.0 froze a foreign run as
 *     `running` forever (a "known id" was never re-read), and 0.19.1 wrote a settled
 *     foreign row back as `running` (memory overwrote every row it knew).
 *   - **No timer.** A run whose process died is converged at READ time: the live rows
 *     are in memory, so a `running` row in the file whose owner is not alive is an
 *     orphan — the same "converge when read" posture the approval window uses.
 *   - **One terminal state, and it is monotone.** `settle()` refuses to overwrite a row
 *     that is already terminal (so a cancel that raced a failure cannot flip the answer
 *     the operator already read), and a row that reached a terminal state never reads as
 *     `running` again: only the owner that started it could make it running and
 *     `settle()` is terminal-once, so a `running` claim for a settled row can only be a
 *     stale writer's — refused on read, repaired on the next write.
 *
 * The store is PER INSTANCE (a factory, not module scope): one registry per
 * mounted row, disposed with its fiber. There is no module-scope mutable state
 * here to register under N12.
 * @module
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { clampedNumber } from './numeric.ts'
import { isProcessAlive, transactIo } from './io.ts'
import type { EvolutionIoLike } from './io.ts'

/** The kinds of long-running work the registry tracks. Extend as rows gain runs. */
export type RunKind = 'maintain'

/** The four terminal-or-live states of a run. */
export type RunState = 'running' | 'succeeded' | 'failed' | 'cancelled'

/** One tracked run. `resultRef` is a path to the run's report, never its content. */
export interface RunRecord {
  id: string
  kind: RunKind
  state: RunState
  startedAt: number
  /** The process that owns a RUNNING record. Required to tell an in-flight run of
   * another plane (both planes share one DSH_HOME) from the orphan of a dead one;
   * absent means the owner cannot be named, which is treated as gone. */
  pid?: number | undefined
  endedAt?: number | undefined
  /** Absolute path of the run's report, written by the run owner at settle. */
  resultRef?: string | undefined
  /** Why the run did not succeed (an abort reason, a validation failure). */
  failure?: string | undefined
}

/** What a started run gets: its id and the signal its work must honour. */
export interface RunHandle {
  readonly id: string
  readonly kind: RunKind
  readonly signal: AbortSignal
  /** When the run was registered — the same instant the record carries. */
  readonly startedAt: number
}

/** How a run ended, as reported by its owner. */
export interface RunOutcome {
  state: 'succeeded' | 'failed' | 'cancelled'
  resultRef?: string | undefined
  failure?: string | undefined
}

/** The registry surface the commands row drives. */
export interface RunRegistry {
  /**
   * Converge the persisted index; the commands row calls it before answering any read.
   * The foreign view is rebuilt wholesale (0.19.3), so a row another plane settled is
   * re-read here instead of being frozen at whatever this process first saw.
   */
  load(): Promise<{ ok: boolean; note?: string }>
  /**
   * Register a new run, arm its cancellation, and return its handle.
   *
   * Resolves only once the row is in the shared index (0.19.1, review P2): the detached
   * lifetime starts when the caller answers "started", so a plane that reads that answer
   * must find the run. The cost is one local index write on the ack path (milliseconds).
   */
  begin(kind: RunKind): Promise<RunHandle>
  /** Record a run's terminal state (first writer wins). */
  settle(id: string, outcome: RunOutcome): Promise<void>
  /** The live run, when there is one (one kind today — see the implementation note). */
  inFlight(): RunRecord | undefined
  /** When the newest terminal run ended (`undefined` when none). */
  lastSettledAt(): number | undefined
  /** Every tracked run, newest first (retained history: cap applied). */
  runs(): readonly RunRecord[]
  /** One run by id, converged view included. */
  find(id: string): RunRecord | undefined
  /** Ask a running run to stop; it settles as `cancelled`. @returns whether it was running. */
  cancel(id: string): boolean
  /** Ask every running run to stop (fiber dispose). @returns how many were running. */
  cancelAll(): number
}

/** Options for {@link newRunRegistry}. */
export interface RunRegistryOptions {
  io: EvolutionIoLike
  /** Evolution home (`evolutionHome()`); the index lives at `<home>/runs.json`. */
  home: string
  /** Warn channel for a failed index write (the run itself is unaffected). */
  warn?: (message: string) => void
  /** Clock seam for tests. */
  now?: () => number
  /** Retained records (N3-clamped). */
  maxRecords?: number
}

/** Current index schema. Bump only for a structural change. */
export const RUNS_SCHEMA_VERSION = 1

/** Retained run records, newest first. */
export const DEFAULT_RUN_RECORDS = 50

/** Index path for a home. */
export function runsFile(home: string): string {
  return join(home, 'runs.json')
}

const TERMINAL: ReadonlySet<RunState> = new Set<RunState>(['succeeded', 'failed', 'cancelled'])

/**
 * Parse an index body into records.
 *
 * `ok: false` means the body could not be read as an index at all — the caller
 * decides what to say (`load()` reports it; `persist()` merges with what it can).
 * @param raw - the file's text, or null when it does not exist.
 * @returns the parsed records and whether the body was an index.
 */
function parseIndex(raw: string | null): { ok: boolean; records: RunRecord[]; foreign: unknown[]; note?: string } {
  if (raw === null) return { ok: true, records: [], foreign: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, records: [], foreign: [] }
  }
  const rows = (parsed as { runs?: unknown }).runs
  if (!Array.isArray(rows)) return { ok: false, records: [], foreign: [] }
  const notes: string[] = []
  const version = (parsed as { schemaVersion?: unknown }).schemaVersion
  if (typeof version === 'number' && version !== RUNS_SCHEMA_VERSION) {
    notes.push(`the index declares schemaVersion ${version} while this build writes ${RUNS_SCHEMA_VERSION}`)
  }
  const records: RunRecord[] = []
  const foreign: unknown[] = []
  for (const row of rows) {
    const record = row as Partial<RunRecord>
    if (typeof record.id !== 'string' || typeof record.startedAt !== 'number') { foreign.push(row); continue }
    if (typeof record.kind !== 'string' || typeof record.state !== 'string') { foreign.push(row); continue }
    if (record.state !== 'running' && !TERMINAL.has(record.state)) {
      // A state this build does not know (a newer writer, or a hand-edited file):
      // it is KEPT as it is — dropping it would silently erase another writer's record.
      foreign.push(row)
      continue
    }
    records.push({
      id: record.id,
      kind: record.kind,
      state: record.state,
      startedAt: record.startedAt,
      ...(typeof record.pid === 'number' ? { pid: record.pid } : {}),
      ...(typeof record.endedAt === 'number' ? { endedAt: record.endedAt } : {}),
      ...(typeof record.resultRef === 'string' ? { resultRef: record.resultRef } : {}),
      ...(typeof record.failure === 'string' ? { failure: record.failure } : {}),
    })
  }
  return { ok: true, records, foreign, ...(notes.length > 0 ? { note: notes.join('; ') } : {}) }
}

/**
 * Create the run registry for one mounted row.
 * @param options - io seam, evolution home, warn channel, clock and record cap.
 * @returns the registry; call {@link RunRegistry.load} once before answering reads.
 */
export function newRunRegistry(options: RunRegistryOptions): RunRegistry {
  const now = options.now ?? (() => Date.now())
  const maxRecords = clampedNumber(options.maxRecords ?? DEFAULT_RUN_RECORDS, DEFAULT_RUN_RECORDS, { min: 1 })
  const warn = options.warn ?? (() => {})
  const path = runsFile(options.home)

  /** Rows THIS process started: its memory is the only truth for them. */
  const owned = new Map<string, RunRecord>()
  /** Rows read from the shared index: the file is the only truth for them. */
  const foreign = new Map<string, RunRecord>()
  /** Cancellation handles — "can this still be stopped", NOT ownership (`settle` drops one). */
  const controllers = new Map<string, AbortController>()

  /** The ONE wording of the orphan verdict. */
  const ORPHAN_FAILURE = 'no live owner process — the run was interrupted before it settled (orphan)'
  /** A row whose owner cannot be reached: `pid` absent (an older build) or not alive. */
  const ownerIsGone = (row: RunRecord): boolean => row.pid === undefined || !isProcessAlive(row.pid)
  /** The verdict is materialized ONCE, so its `endedAt` (and the duration a reader sees) is stable. */
  const orphanOf = (row: RunRecord): RunRecord => ({ ...row, state: 'failed', endedAt: now(), failure: ORPHAN_FAILURE })

  /** Every row this process knows, newest first. ALL reads go through here. */
  const view = (): RunRecord[] => [...owned.values(), ...foreign.values()].sort((a, b) => b.startedAt - a.startedAt)

  /** Retained history: every running row plus the newest terminal ones (one cap, both planes). */
  const capped = (rows: readonly RunRecord[]): RunRecord[] => {
    const live = rows.filter(row => row.state === 'running')
    const done = rows
      .filter(row => TERMINAL.has(row.state))
      .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
      .slice(0, maxRecords)
    return [...live, ...done].sort((a, b) => b.startedAt - a.startedAt)
  }

  /**
   * Update a surviving foreign row in place (identity stable), or add it.
   *
   * Monotone states (0.19.3): a row already known TERMINAL is never shown as `running`
   * again. Only the owner that started a run could make it running, and `settle()` is
   * terminal-once — so a `running` claim for a settled row can only come from a stale
   * writer (an older plane holding an outdated view), and adopting it would propagate the
   * resurrection to every other plane.
   * @returns true when the row was refused as exactly that regression.
   */
  const adopt = (row: RunRecord): boolean => {
    const existing = foreign.get(row.id)
    if (existing === undefined) {
      foreign.set(row.id, row)
      return false
    }
    if (TERMINAL.has(existing.state) && !TERMINAL.has(row.state)) return true
    // Clear what the new row dropped, so nothing is inherited from the previous view.
    delete existing.endedAt
    delete existing.resultRef
    delete existing.failure
    Object.assign(existing, row)
    return false
  }

  const persist = async (): Promise<void> => {
    try {
      // Read-modify-write under the io backend's cross-process lock. The file is the
      // BASE and only THIS process's rows are laid over it ("one writer per row"); the
      // single write a non-owner may make is the orphan verdict for a row whose owner is
      // gone. The row read inside this transaction IS the compare-and-swap: if its owner
      // settled it in between, it no longer reads as `running` and is left alone.
      await transactIo(options.io, path, (current) => {
        const onDisk = parseIndex(current)
        const merged = new Map<string, RunRecord>()
        for (const row of onDisk.records) merged.set(row.id, row)
        for (const [id, row] of owned) merged.set(id, row)
        // Repair a stale writer's regression: this process READ the owner's terminal
        // verdict, so re-asserting it is not authoring state — it refuses to propagate a
        // stale overwrite. Without this, a fresh plane would see the resurrected `running`
        // row and hold its in-flight guard (the 0.19.0 symptom, one plane later).
        for (const [id, row] of foreign) {
          const onDiskRow = merged.get(id)
          if (TERMINAL.has(row.state) && onDiskRow !== undefined && !TERMINAL.has(onDiskRow.state)) merged.set(id, row)
        }
        for (const [id, row] of merged) {
          if (row.state === 'running' && !owned.has(id) && ownerIsGone(row)) merged.set(id, orphanOf(row))
        }
        const kept = capped([...merged.values()])
        const live = kept.filter(row => row.state === 'running')
        const done = kept.filter(row => TERMINAL.has(row.state))
        // Rows this build does not understand ride along untouched (P2-5): it cannot
        // judge them, and dropping them would erase another writer's record.
        return JSON.stringify({ schemaVersion: RUNS_SCHEMA_VERSION, runs: [...live, ...done, ...onDisk.foreign] }, null, 2)
      })
    } catch (error) {
      warn(`evolution-core: could not persist the run index (${error instanceof Error ? error.message : String(error)})`)
    }
  }

  return {
    async load() {
      let raw: string | null
      try {
        raw = await options.io.readText(path)
      } catch (error) {
        // A read FAILURE is not "no runs": say so instead of presenting an empty
        // registry as a clean history (the same three-state rule the probe files use).
        return { ok: false, note: `run index unreadable: ${error instanceof Error ? error.message : String(error)}` }
      }
      const parsed = parseIndex(raw)
      if (!parsed.ok) {
        return { ok: false, note: 'run index could not be read as an index (not JSON, or no runs array) — the previous run history is unknown (the reports are unaffected)' }
      }
      // The foreign view is REBUILT wholesale: a row this process does not own is whatever
      // the index says it is, every time. (0.19.0 kept "known" ids frozen, which is how a
      // settled foreign run answered `running` until the observing process restarted.)
      // Surviving rows are updated in place so a reader that held one across the load
      // keeps a live view; rows that vanished from the index are dropped.
      const wasRunning = new Set([...foreign.values()].filter(row => row.state === 'running').map(row => row.id))
      const seen = new Set<string>()
      let converged = 0
      let liveElsewhere = 0
      let followed = 0
      let regressed = 0
      for (const row of parsed.records) {
        if (owned.has(row.id)) continue
        seen.add(row.id)
        if (row.state !== 'running') {
          if (wasRunning.has(row.id)) followed++
          if (adopt(row)) regressed++
          continue
        }
        // A running row whose OWNER is alive belongs to another process sharing this home:
        // genuinely in flight, never rewritten here (review P1-1). A row that cannot name
        // its owner is treated as gone — the conservative side, and what a row written by
        // an older build looks like.
        if (ownerIsGone(row)) {
          converged++
          adopt(orphanOf(row))
          continue
        }
        liveElsewhere++
        if (adopt(row)) regressed++
      }
      for (const id of [...foreign.keys()]) {
        if (!seen.has(id)) foreign.delete(id)
      }
      if (converged > 0 || regressed > 0) await persist()
      const notes = [
        parsed.note,
        converged > 0 ? `${converged} run(s) with no live owner were recorded as failed(orphan)` : undefined,
        liveElsewhere > 0 ? `${liveElsewhere} run(s) are in flight in another process sharing this home` : undefined,
        followed > 0 ? `${followed} run(s) settled by their owner were re-read from the index` : undefined,
        regressed > 0 ? `${regressed} settled run(s) stayed settled although the index claimed they were running` : undefined,
      ].filter((note): note is string => note !== undefined)
      return { ok: true, ...(notes.length > 0 ? { note: notes.join('; ') } : {}) }
    },

    async begin(kind) {
      const id = randomUUID()
      const startedAt = now()
      const controller = new AbortController()
      controllers.set(id, controller)
      // The pid is what lets ANOTHER process tell this live run from an orphan.
      owned.set(id, { id, kind, state: 'running', startedAt, pid: process.pid })
      // Write-through (0.19.1, review P2): answering "started" promises a run another
      // plane can read, so the row reaches the index before this resolves. `persist()`
      // warns instead of throwing, so an unwritable home cannot withhold the handle.
      await persist()
      return { id, kind, signal: controller.signal, startedAt }
    },

    async settle(id, outcome) {
      const row = owned.get(id)
      // Terminal-once: a cancel that raced the run's own failure must not flip the
      // answer the operator already read.
      if (row === undefined || TERMINAL.has(row.state)) return
      row.state = outcome.state
      row.endedAt = now()
      if (outcome.resultRef !== undefined) row.resultRef = outcome.resultRef
      if (outcome.failure !== undefined) row.failure = outcome.failure
      controllers.delete(id)
      await persist()
    },

    // The registry tracks ONE kind today (`RunKind` = 'maintain'), so these reads take no
    // kind filter — a comparison the type system already knows is true. Re-add the
    // parameter (and the filter) together with the second `RunKind` member.
    inFlight() {
      return view().find(row => row.state === 'running')
    },

    lastSettledAt() {
      return view().find(row => TERMINAL.has(row.state))?.endedAt
    },

    runs() {
      return capped(view())
    },

    find(id) {
      return owned.get(id) ?? foreign.get(id)
    },

    cancel(id) {
      // Only work THIS process started can be stopped. A running row loaded from the
      // index belongs to another process sharing this home (review P1-1), and marking it
      // cancelled here would fabricate a terminal state for work that is still running
      // there — so an unowned id is refused, not "cancelled". (`controllers` is the
      // right test here precisely because it is about stopping, not about authority.)
      const controller = controllers.get(id)
      if (controller === undefined) return false
      const row = owned.get(id)
      if (row === undefined || row.state !== 'running') return false
      controller.abort()
      controllers.delete(id)
      row.state = 'cancelled'
      row.endedAt = now()
      row.failure = 'cancelled by operator'
      void persist()
      return true
    },

    cancelAll() {
      let count = 0
      for (const id of [...controllers.keys()]) {
        if (this.cancel(id)) count++
      }
      return count
    },
  }
}
