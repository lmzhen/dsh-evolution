/**
 * G3/3.2 (audit 06-performance.md 接缝 C): ONE declaration for every bounded store.
 *
 * Before this file the family had eight retention rules scattered across four packages and no place
 * that could answer "how long does this record live under the current policy" (S1.md 4.3): six caps
 * were named constants, three lived inline (snapshots 5, reports 20/20/10, archive 365d). Each entry
 * below states its bound AND the code that declares it, so a gate can compare the two sets.
 *
 * `declare` is an ARRAY because one store may have several declaration sites (the report buckets are
 * kept by two packages). The `inline` branch matches a CODE SNIPPET rather than a line number: line
 * numbers rot on every edit above them, a snippet survives (and a snippet that stops matching is the
 * detector the gate wants). No naming convention is assumed anywhere - that is the whole point of a
 * ledger: the list IS the declaration.
 */

/** How one bound is declared in code. `named` resolves a constant; `inline` matches a snippet in a file. */
export type StoreBoundDeclare =
  | { readonly kind: 'named'; readonly module: string; readonly name: string; readonly value: number | string }
  | { readonly kind: 'inline'; readonly file: string; readonly contains: string; readonly value: string }

/** One bounded store: what it is, who owns it, what bounds it, and where that bound is declared. */
export interface StoreSpec {
  readonly id: string
  /** The package that keeps the store (the one a reclamation change belongs to). */
  readonly owner: string
  readonly unit: 'bytes' | 'files' | 'entries'
  /** The bound itself, as a person reads it (a cap, or a policy phrase when removal is report-only). */
  readonly bound: string
  /** What makes an entry removable - the cutoff the bound counts over. */
  readonly cutoff: string
  readonly trigger: 'write' | 'run-end' | 'pass-end' | 'manual'
  /** Where a footprint reading for this store comes from (the field 3.3 reports). */
  readonly artifact: string
  readonly declare: readonly StoreBoundDeclare[]
}

/** The one list. A new bounded store that is not registered here is what the G3 gate refuses. */
export const STORE_LEDGER: readonly StoreSpec[] = [
  {
    id: 'archive-entries',
    owner: 'evolution-core',
    unit: 'entries',
    bound: '365 days, report-only by default (the removal policy is report, not delete)',
    cutoff: 'archivedAt older than the retention window',
    trigger: 'run-end',
    artifact: 'count of .archive entries and their ages',
    declare: [
      // The window and the policy are two declarations on purpose: the bound is the window, and the
      // policy decides whether crossing it deletes or only reports (audit S1-01: the message promised
      // recoverability from a snapshot chain that is five deep).
      { kind: 'inline', file: 'packages/evolution-core/src/skill-store.ts', contains: 'ARCHIVE_RETENTION_DAYS = 365', value: '365 days' },
      { kind: 'named', module: 'evolution-core/src/limits.ts', name: 'DEFAULT_ARCHIVE_RETENTION_POLICY', value: 'report' },
    ],
  },
  {
    id: 'skill-snapshots',
    owner: 'evolution-core',
    unit: 'entries',
    bound: '5 snapshots',
    cutoff: 'oldest snapshot beyond the keep window',
    trigger: 'run-end',
    artifact: 'snapshot count and total bytes',
    declare: [{ kind: 'inline', file: 'packages/evolution-core/src/skill-store.ts', contains: 'retainSnapshots(5)', value: '5' }],
  },
  {
    id: 'skill-versions',
    owner: 'evolution-core',
    unit: 'entries',
    bound: '20 versions per skill',
    cutoff: 'history index entries beyond versionKeep',
    trigger: 'write',
    artifact: 'history index length per skill',
    declare: [{ kind: 'named', module: 'evolution-core/src/constants.ts', name: 'DEFAULT_SKILL_VERSION_KEEP', value: 20 }],
  },
  {
    id: 'pending-resolved',
    owner: 'evolution-state-storage',
    unit: 'entries',
    bound: '200 resolved pending records',
    cutoff: 'resolved records beyond the cap',
    trigger: 'write',
    artifact: 'resolved record count',
    declare: [{ kind: 'named', module: 'evolution-state-storage/src/constants.ts', name: 'PENDING_RESOLVED_CAP', value: 200 }],
  },
  {
    id: 'review-session',
    owner: 'evolution-state-storage',
    unit: 'entries',
    bound: '500 review session rows',
    cutoff: 'rows beyond the session cap',
    trigger: 'write',
    artifact: 'review state row count',
    declare: [{ kind: 'named', module: 'evolution-state-storage/src/constants.ts', name: 'REVIEW_STATE_SESSION_CAP', value: 500 }],
  },
  {
    id: 'reports',
    owner: 'evolution-commands',
    unit: 'files',
    bound: '20/20/10 files across the three report buckets',
    cutoff: 'reports beyond each bucket keep',
    trigger: 'run-end',
    artifact: 'report file count per bucket',
    declare: [
      { kind: 'inline', file: 'packages/evolution-commands/src/index.ts', contains: 'maintain-', value: '20' },
      { kind: 'inline', file: 'packages/evolution-curator/src/index.ts', contains: 'errorKeep', value: '10' },
    ],
  },
  {
    id: 'event-archives',
    owner: 'evolution-core',
    unit: 'files',
    bound: '10 archived event logs',
    cutoff: 'archives beyond the retention count',
    trigger: 'write',
    artifact: 'event archive count',
    declare: [{ kind: 'named', module: 'evolution-core/src/evolution-events.ts', name: 'EVENT_LOG_RETAIN_ARCHIVES', value: 10 }],
  },
  {
    id: 'run-records',
    owner: 'evolution-core',
    unit: 'entries',
    bound: '50 run records',
    cutoff: 'runs beyond the record cap',
    trigger: 'write',
    artifact: 'runs.json record count',
    declare: [{ kind: 'named', module: 'evolution-core/src/run-registry.ts', name: 'DEFAULT_RUN_RECORDS', value: 50 }],
  },
  {
    id: 'support-reads',
    owner: 'evolution-core',
    unit: 'entries',
    bound: '200 support_reads keys',
    cutoff: 'keys beyond the read-path cap',
    trigger: 'write',
    artifact: 'usage sidecar key count',
    declare: [{ kind: 'named', module: 'evolution-core/src/usage.ts', name: 'MAX_SUPPORT_READ_PATHS', value: 200 }],
  },
]
