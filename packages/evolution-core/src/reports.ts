/**
 * 0.19.0 (S2): the family's ONE report-retention sweep.
 *
 * Reports accumulate by design (every run writes one), so each kind needs a
 * window or the reports home becomes an unbounded directory. The logic lived
 * inside the curator only; the maintenance run reports added in 0.19.0 needed
 * the same thing, and a second copy of "list, order, delete beyond the window"
 * is exactly the kind of near-duplicate this family treats as a defect.
 *
 * Three behaviours are the curator's, kept verbatim because they are the reason
 * the sweep is safe to run at all:
 *
 *   - An UNLISTABLE directory is not "no reports" — nothing is deleted and the
 *     caller is told (the same three-state rule the probe files use).
 *   - A report with no usable timestamp is KEPT (never delete what cannot be
 *     ordered) and the fact is said out loud once.
 *   - The order is TOTAL: declared time, then mtime, then name. A tie falling
 *     through to readdir order evicted a different set per platform (CI-caught).
 * @module
 */

import { join } from 'node:path'
import { isPresent, isUnknown, probeList, probeMtime, reportTime } from './probe.ts'
// `evolutionHome` is owned by state-store.ts (its ONLY definition) — importing it
// from env.ts yields an undefined binding that only throws at call time.
import { evolutionHome } from './state-store.ts'
import type { EvolutionIoLike } from './io.ts'

/**
 * The lock target a reports sweep holds for one home.
 *
 * `transactIo` takes the IO write lock on THIS path (minting `<path>.lock` with
 * the io protocol's `pid:token` body) and holds it for the whole task; nothing
 * ever writes the target, because the sweep's exclusion is the point. It lives
 * inside `<home>/reports` next to the directory it protects (the sweeps' own name
 * filters ignore it, and the lock file is removed on release).
 *
 * Moved here from evolution-curator in 0.19.0 (S2): the maintenance reports'
 * sweep needs the SAME exclusion, and a second lock would protect nothing.
 * @returns the lock target path.
 */
export function reportsSweepLockTarget(): string {
  return join(evolutionHome(), 'reports', '.retention')
}

/** One retention window: files whose name starts with `prefix`, newest `keep` survive. */
export interface ReportBucket {
  prefix: string
  keep: number
}

/** Inputs for {@link sweepReports}. */
export interface SweepReportsOptions {
  io: EvolutionIoLike
  /** Reports directory (`<evolutionHome()>/reports`). */
  dir: string
  /** Buckets. The FIRST prefix that matches classifies a file — pass specific ones first. */
  buckets: readonly ReportBucket[]
  /** Warn channel for an unlistable directory or an unorderable report. */
  warn?: ((message: string) => void) | undefined
  /** Prefix of the warning messages, naming the owning package. */
  owner: string
}

/** One dated report, as the sweep orders them. */
interface DatedReport {
  name: string
  startedAt: number
  mtime: number | null
}

/**
 * Delete the reports beyond each bucket's window, each with its `.md` digest.
 *
 * Best-effort by construction: pruning never fails the run that wrote a report.
 * @param options - io seam, directory, windows, warn channel and owner name.
 * @returns nothing; deletions and skips are reported through `warn`.
 */
export async function sweepReports(options: SweepReportsOptions): Promise<void> {
  const warn = options.warn ?? (() => {})
  const listed = await probeList(options.io, options.dir)
  if (isUnknown(listed)) {
    warn(`${options.owner}: report retention skipped — the reports directory could not be listed (${listed.reason})`)
    return
  }
  const entries = isPresent(listed) ? listed.value : []
  // Longest prefix first: `curator-error-` must win over `curator-`.
  const buckets = [...options.buckets].sort((a, b) => b.prefix.length - a.prefix.length)
  const dated = new Map<string, DatedReport[]>(buckets.map(bucket => [bucket.prefix, []]))
  let unorderableWarned = false
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    const bucket = buckets.find(item => name.startsWith(item.prefix))
    if (!bucket) continue
    try {
      const path = join(options.dir, name)
      const raw = await options.io.readText(path)
      if (raw === null) continue
      // The ordering time comes from ONE place (`reportTime`): the declared
      // `startedAt`, then the declared `at`, then the optional mtime probe.
      const startedAt = await reportTime(options.io, path, JSON.parse(raw))
      const probed = await probeMtime(options.io, path)
      const mtime = isPresent(probed) ? probed.value : null
      if (startedAt !== null) dated.get(bucket.prefix)?.push({ name, startedAt, mtime })
      else if (!unorderableWarned) {
        unorderableWarned = true
        warn(`${options.owner}: report "${name}" carries no usable timestamp and this backend has no mtime probe - it is kept outside the retention window`)
      }
    } catch {
      // Unclassifiable report: keep it — never delete what we cannot order.
    }
  }
  // TOTAL order (v46 review, CI-caught): declared time, then mtime, then name.
  const newestFirst = (a: DatedReport, b: DatedReport): number =>
    b.startedAt - a.startedAt || (b.mtime ?? 0) - (a.mtime ?? 0) || b.name.localeCompare(a.name)
  for (const bucket of buckets) {
    const rows = dated.get(bucket.prefix) ?? []
    rows.sort(newestFirst)
    for (const old of rows.slice(bucket.keep)) {
      const stem = old.name.replace(/\.json$/, '')
      try {
        await options.io.remove(join(options.dir, old.name))
      } catch {
        // Best-effort pruning.
      }
      try {
        await options.io.remove(join(options.dir, `${stem}.md`))
      } catch {
        // The digest may already be gone (or never existed); keep going.
      }
    }
  }
}
