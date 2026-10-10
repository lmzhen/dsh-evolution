/**
 * 0.19.0 (S2): the family's run-lifecycle owner.
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
 * Two disciplines are structural, not stylistic:
 *
 *   - **No timer.** A run whose process died is converged at READ time: the index
 *     file can only carry `running` records written by a PREVIOUS process life,
 *     because the live ones are in memory. `load()` therefore rewrites every
 *     `running` record as `failed(orphan)` once — the same "converge when read"
 *     posture the approval window uses for its TTL.
 *   - **One terminal state.** `settle()` refuses to overwrite a record that is
 *     already terminal, so a cancel that raced a failure cannot flip the answer
 *     the operator already read.
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
  /** Converge the persisted index once at mount; see the module doc. */
  load(): Promise<{ ok: boolean; note?: string }>
  /** Register a new run, arm its cancellation, and return its handle. */
  begin(kind: RunKind): RunHandle
  /** Record a run's terminal state (first writer wins). */
  settle(id: string, outcome: RunOutcome): Promise<void>
  /** The live run, when there is one (one kind today — see the implementation note). */
  inFlight(): RunRecord | undefined
  /** When the newest terminal run ended (`undefined` when none). */
  lastSettledAt(): number | undefined
  /** Every tracked run, newest first. */
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
  const records: RunRecord[] = []
  const controllers = new Map<string, AbortController>()

  const ordered = (): RunRecord[] => [...records].sort((a, b) => b.startedAt - a.startedAt)

  /** Keep every RUNNING record plus the newest terminal ones: memory and the
   * index share one cap, so the two can never disagree about the history. */
  const trim = (): void => {
    const terminal = records
      .filter(record => TERMINAL.has(record.state))
      .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
    for (const stale of terminal.slice(maxRecords)) {
      const index = records.indexOf(stale)
      if (index >= 0) records.splice(index, 1)
    }
  }

  const persist = async (): Promise<void> => {
    trim()
    try {
      // Read-modify-write under the io backend's cross-process lock, and MERGE
      // rather than overwrite: the desktop and web planes share one DSH_HOME, so
      // two hosts each know their own runs and the index is their shared view.
      // (trim() already bounded the terminal history and kept every running
      // record — a second slice here could drop the LIVE run out of the index.)
      await transactIo(options.io, path, (current) => {
        const onDisk = parseIndex(current)
        const merged = new Map<string, RunRecord>()
        for (const record of onDisk.records) merged.set(record.id, record)
        // This process's own records win: it knows their state better than a file.
        for (const record of records) merged.set(record.id, record)
        const view = [...merged.values()].sort((a, b) => b.startedAt - a.startedAt)
        const live = view.filter(record => record.state === 'running')
        const done = view.filter(record => TERMINAL.has(record.state)).slice(0, maxRecords)
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
      let converged = 0
      let liveElsewhere = 0
      for (const record of parsed.records) {
        // Idempotent merge: a record this process already knows (its own runs, or an
        // earlier load) is never re-added, so load() can be called again to pick up
        // what another process wrote.
        if (records.some(item => item.id === record.id)) continue
        if (record.state !== 'running') {
          records.push(record)
          continue
        }
        // A running record whose OWNER is still alive belongs to another process
        // sharing this home: it is genuinely in flight, not an orphan (review P1-1).
        // A record that cannot name its owner is treated as gone — the conservative
        // side, and what a record written by an older build looks like.
        if (record.pid !== undefined && isProcessAlive(record.pid)) {
          liveElsewhere++
          records.push(record)
          continue
        }
        converged++
        records.push({ ...record, state: 'failed', endedAt: now(), failure: 'no live owner process — the run was interrupted before it settled (orphan)' })
      }
      if (converged > 0) await persist()
      const notes = [
        parsed.note,
        converged > 0 ? `${converged} run(s) with no live owner were recorded as failed(orphan)` : undefined,
        liveElsewhere > 0 ? `${liveElsewhere} run(s) are in flight in another process sharing this home` : undefined,
      ].filter((note): note is string => note !== undefined)
      return { ok: true, ...(notes.length > 0 ? { note: notes.join('; ') } : {}) }
    },

    begin(kind) {
      const id = randomUUID()
      const startedAt = now()
      const controller = new AbortController()
      controllers.set(id, controller)
      // The pid is what lets ANOTHER process tell this live run from an orphan.
      records.push({ id, kind, state: 'running', startedAt, pid: process.pid })
      void persist()
      return { id, kind, signal: controller.signal, startedAt }
    },

    async settle(id, outcome) {
      const record = records.find(item => item.id === id)
      // Terminal-once: a cancel that raced the run's own failure must not flip the
      // answer the operator already read.
      if (!record || TERMINAL.has(record.state)) return
      record.state = outcome.state
      record.endedAt = now()
      if (outcome.resultRef !== undefined) record.resultRef = outcome.resultRef
      if (outcome.failure !== undefined) record.failure = outcome.failure
      controllers.delete(id)
      await persist()
    },

    // The registry tracks ONE kind today (`RunKind` = 'maintain'), so these reads take no
    // kind filter — a comparison the type system already knows is true. Re-add the
    // parameter (and the filter) together with the second `RunKind` member.
    inFlight() {
      return ordered().find(record => record.state === 'running')
    },

    lastSettledAt() {
      return ordered().find(record => TERMINAL.has(record.state))?.endedAt
    },

    runs() {
      return ordered()
    },

    find(id) {
      return records.find(record => record.id === id)
    },

    cancel(id) {
      // Only work THIS process started can be stopped. A running record loaded from
      // the index belongs to another process sharing this home (review P1-1), and
      // marking it cancelled here would fabricate a terminal state for work that is
      // still running there — so an unowned id is refused, not "cancelled".
      const controller = controllers.get(id)
      if (controller === undefined) return false
      const record = records.find(item => item.id === id)
      if (!record || record.state !== 'running') return false
      controller.abort()
      controllers.delete(id)
      record.state = 'cancelled'
      record.endedAt = now()
      record.failure = 'cancelled by operator'
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
