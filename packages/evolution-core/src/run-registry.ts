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
  /** The live run of one kind, when there is one. */
  inFlight(kind: RunKind): RunRecord | undefined
  /** When the newest terminal run of one kind ended (`undefined` when none). */
  lastSettledAt(kind: RunKind): number | undefined
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
      // trim() already bounded the terminal history and kept every running record:
      // a second slice here could drop the LIVE run out of the index.
      const body = JSON.stringify({ schemaVersion: RUNS_SCHEMA_VERSION, runs: ordered() }, null, 2)
      await options.io.writeText(path, body)
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
      if (raw === null) return { ok: true }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return { ok: false, note: 'run index is not JSON — the previous run history is unknown (the reports are unaffected)' }
      }
      const rows = (parsed as { runs?: unknown }).runs
      if (!Array.isArray(rows)) return { ok: false, note: 'run index carries no runs array — the previous run history is unknown' }
      let converged = 0
      for (const row of rows) {
        const record = row as Partial<RunRecord>
        if (typeof record.id !== 'string' || typeof record.startedAt !== 'number') continue
        if (typeof record.kind !== 'string' || typeof record.state !== 'string') continue
        if (record.state === 'running') {
          // The process that wrote this cannot be alive (it would hold the record
          // in memory and never re-read it as running) — converge, do not guess.
          converged++
          records.push({ id: record.id, kind: record.kind as RunKind, state: 'failed', startedAt: record.startedAt, endedAt: now(), failure: 'interrupted by a host restart before it settled (orphan)' })
          continue
        }
        records.push({ id: record.id, kind: record.kind as RunKind, state: record.state as RunState, startedAt: record.startedAt, ...(typeof record.endedAt === 'number' ? { endedAt: record.endedAt } : {}), ...(typeof record.resultRef === 'string' ? { resultRef: record.resultRef } : {}), ...(typeof record.failure === 'string' ? { failure: record.failure } : {}) })
      }
      if (converged > 0) await persist()
      return { ok: true, ...(converged > 0 ? { note: `${converged} run(s) interrupted by a host restart were recorded as failed(orphan)` } : {}) }
    },

    begin(kind) {
      const id = randomUUID()
      const startedAt = now()
      const controller = new AbortController()
      controllers.set(id, controller)
      records.push({ id, kind, state: 'running', startedAt })
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

    inFlight(kind) {
      return ordered().find(record => record.kind === kind && record.state === 'running')
    },

    lastSettledAt(kind) {
      return ordered().find(record => record.kind === kind && TERMINAL.has(record.state))?.endedAt
    },

    runs() {
      return ordered()
    },

    find(id) {
      return records.find(record => record.id === id)
    },

    cancel(id) {
      const record = records.find(item => item.id === id)
      if (!record || record.state !== 'running') return false
      controllers.get(id)?.abort()
      controllers.delete(id)
      record.state = 'cancelled'
      record.endedAt = now()
      record.failure = 'cancelled by operator'
      void persist()
      return true
    },

    cancelAll() {
      let count = 0
      for (const record of [...records]) {
        if (record.state === 'running') {
          count++
          void this.cancel(record.id)
        }
      }
      return count
    },
  }
}
