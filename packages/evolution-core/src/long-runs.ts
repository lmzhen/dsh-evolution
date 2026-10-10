/**
 * 0.19.0 (S4): the family's long-run inventory — one table, one owner per entry.
 *
 * A "long run" is work whose duration is NOT bounded by the interaction that asked
 * for it: a maintenance scan, a curator pass, a review pass. The measured fact this
 * table exists to record is that a CLIENT can end a request long before the work is
 * done (measured: the desktop shell ends a request at ~305 s while the same command
 * finishes in 949.7 s on the web plane), so the lifetime of such work must come from
 * its OWNER — never from the request.
 *
 * Two fields carry the judgments, and a spec pins both:
 *
 *   - `lifetime`: `'plugin'` entries must name an owner and a result home (the work
 *     outlives the request and must be readable afterwards); `'request'` entries
 *     must say WHY their cost cannot reach the wall.
 *   - `measured`: only measured numbers, with their basis. An unmeasured bound is
 *     written as exactly that — this table is not a place to guess.
 *
 * The rendered table is pinned byte-for-byte into `packages/README.md` by
 * `tests/long-runs.spec.ts` (the T-WD2 pattern the command registry already uses),
 * so the published table cannot drift from this list.
 * @module
 */

/** What kind of work an entry describes. */
export type LongRunKind = 'command' | 'tool' | 'pass'

/** Whose lifetime the work borrows. `'plugin'` = it must outlive the request. */
export type LongRunLifetime = 'request' | 'plugin'

/** One entry of the long-run inventory. */
export interface LongRunEntry {
  /** Command/entry id as a user sees it. */
  id: string
  kind: LongRunKind
  /** The package that owns the work (its lifecycle, its budget, its result). */
  owner: string
  lifetime: LongRunLifetime
  /** The measured cost, with its basis. Never a guess. */
  measured: string
  /** Where the deadline/budget comes from, or why there is none. */
  budget: string
  /** Where a result is readable after the work settles. */
  resultHome: string
  note: string
}

/**
 * The inventory. Order is the rendered order; a spec pins it into the README.
 */
export const LONG_RUNS: readonly LongRunEntry[] = [
  {
    id: '/evolution maintain',
    kind: 'command',
    owner: 'evolution-commands',
    lifetime: 'plugin',
    measured: 'the same scan measured 949.7 s end to end on the web plane (no Electron); the desktop shell ends the REQUEST at ~305 s (four runs: 305.6/307.0/306.0/305.7 s)',
    budget: 'maintainTimeoutMs (row config, default 600000) or --timeout <ms> for one run',
    resultHome: '<evolutionHome>/reports/maintain-<runId>.{json,md}, indexed in <evolutionHome>/runs.json',
    note: 'The ~305 s wall is a CLIENT lifetime, not a budget: the run keeps working and the result is read back with maintain status/report. Its cancellation is the run registry handle (maintain cancel <id>) or plugin dispose.',
  },
  {
    id: 'maintenance_probe',
    kind: 'tool',
    owner: 'evolution-maintenance',
    lifetime: 'request',
    measured: '188/220/225 ms on the deployed library (28 skills / 418 KB); ~5.5 ms per skill and linear (100 skills 0.4-0.6 s, 400 skills 1.9-2.5 s)',
    budget: 'none, deliberately: reaching the ~305 s wall would take roughly 5e4 skills',
    resultHome: 'the tool result (JSON detail), answered in-turn',
    note: 'O(2N) tree reads (enrichment + snapshot), uncached by design. Reopen the budget question when the library nears ~1e4 skills, when the io provider stops being local, or when a model leg enters a tool execute.',
  },
  {
    id: 'skill_manage',
    kind: 'tool',
    owner: 'tool-skill-manage',
    lifetime: 'request',
    measured: 'not measured as a duration: single-file IO plus a library listing the cross-source gate already reads; the only unbounded wait is a HUMAN answer',
    budget: 'its own gate deadline (skillWriteConfirm + pendingTtlMs) — a second budget here would compete with it',
    resultHome: 'the tool result, plus the mutation audit records',
    note: 'The human wait is the reason this entry exists: it is bounded by the write gate, which the tool owns.',
  },
  {
    id: 'memory',
    kind: 'tool',
    owner: 'tool-memory',
    lifetime: 'request',
    measured: 'single-file IO on the memory store',
    budget: 'none needed',
    resultHome: 'the tool result',
    note: 'No tree walk, no model leg, no human wait.',
  },
  {
    id: 'curator pass',
    kind: 'pass',
    owner: 'evolution-curator',
    lifetime: 'plugin',
    measured: 'not measured end to end; the LLM nomination leg is bounded separately',
    budget: 'curatorReviewTimeoutMs (E3 parameter) for the LLM leg',
    resultHome: '<evolutionHome>/reports/curator-<runId>.{json,md}',
    note: 'Runs from the plugin interval timer, and a failed or timed-out LLM leg is a distinguishable state in the run report (nominationsWarnings).',
  },
  {
    id: 'review pass',
    kind: 'pass',
    owner: 'evolution-review',
    lifetime: 'plugin',
    measured: 'not measured end to end; the subagent leg carries its own deadline',
    budget: 'reviewTimeoutMs (E2 parameter)',
    resultHome: 'the review inbox plus evolution/plan-applied',
    note: 'The write leg replays a staged plan through the registered runner; cancellation follows the plugin fiber.',
  },
]

/**
 * Render the inventory as the README table rows (no header).
 * @returns one markdown row per entry, in inventory order.
 */
export function renderLongRunTable(): string {
  return LONG_RUNS.map(entry =>
    `| \`${entry.id}\` | ${entry.kind} | ${entry.owner} | ${entry.lifetime} | ${entry.measured} | ${entry.resultHome} |`,
  ).join('\n')
}
