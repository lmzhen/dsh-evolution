/**
 * G3/3.3: the footprint reading for one maintenance run.
 *
 * One line per REGISTERED store (STORE_LEDGER), never a line per store that happened to be readable: the
 * auditor must be able to tell "measured zero" from "not measured" (I3: not-done must never read as
 * nothing-to-do). This first cut reads the stores whose artifact needs only the home-relative path the
 * runtime already knows; everything else renders UNKNOWN with the reason, so the block is honest today
 * and becomes informative as each reader lands.
 */
import { join } from 'node:path'
import { STORE_LEDGER, evolutionHome } from '@deepseek-ai/dsh-evolution-core'
import type { StoreFootprint } from './render-facts.ts'
import type { ReachabilityIo } from '@deepseek-ai/dsh-evolution-core'

/**
 * The io surface this reading needs; a runtime without it yields UNKNOWN for every store.
 *
 * It EXTENDS the reachability read surface instead of restating it: this module drives those readings,
 * so the reads they need are the reads it needs. Restating them here is what produced the same
 * "argument not assignable" error three times - the surface now has ONE owner (`ReachabilityIo`) and this
 * adds only the probe the report sweep uses on top.
 */
export interface FootprintIo extends ReachabilityIo {
  mtime?(path: string): Promise<number | null>
}

/**
 * Read what can be read, and say so for everything else.
 * @param io - the runtime io, or undefined when the caller has none (every store then reads UNKNOWN).
 * @returns one reading per registered store, in ledger order.
 */
export async function reclamationFootprint(io: FootprintIo | undefined): Promise<StoreFootprint[]> {
  const out: StoreFootprint[] = []
  for (const store of STORE_LEDGER) {
    if (io === undefined) {
      out.push({ id: store.id, unit: store.unit, bound: store.bound, skipped: 'the maintenance runtime has no io; nothing was measured' })
      continue
    }
    if (store.id === 'reports') {
      try {
        const names = await io.list(join(evolutionHome(), 'reports'))
        out.push({ id: store.id, unit: store.unit, bound: store.bound, used: names.length, lastSweep: 'see the curator run end', removed: undefined })
      } catch {
        out.push({ id: store.id, unit: store.unit, bound: store.bound, skipped: 'the reports directory could not be listed' })
      }
      continue
    }
    out.push({ id: store.id, unit: store.unit, bound: store.bound, skipped: 'no reader yet for this store' })
  }
  return out
}

/**
 * G3/3.4: the three reachability readings, folded into the footprint channel so the report has ONE shape.
 *
 * Paths come from the caller: the history root and the snapshot root live under the skills root, and the
 * reports directory under the evolution home. A runtime that does not state its skills root gets UNKNOWN
 * for the two rooted domains instead of a guess - the same three-state rule the rest of this file uses.
 * @param io - the runtime io, or undefined when the caller has none.
 * @param skillRoot - the configured skills root, or undefined when the runtime does not state one.
 */
export async function reachabilityFootprint(io: FootprintIo | undefined, skillRoot: string | undefined): Promise<StoreFootprint[]> {
  const domains = ['history.blobs', 'reports.files', 'backups.trees']
  if (io === undefined) {
    return domains.map(domain => ({ id: domain, unit: 'files', bound: 'unmeasured', skipped: 'the maintenance runtime has no io; nothing was measured' }))
  }
  const { historyReachability, reportsReachability, backupsReachability } = await import('@deepseek-ai/dsh-evolution-core')
  const out: StoreFootprint[] = []
  if (skillRoot === undefined) {
    for (const domain of ['history.blobs', 'backups.trees']) {
      out.push({ id: domain, unit: 'files', bound: 'unmeasured', skipped: 'the runtime states no skills root; the reading was not attempted' })
    }
  } else {
    const history = await historyReachability(io, join(skillRoot, '.history'))
    out.push({ id: history.domain, unit: history.unit, bound: history.baseline, used: history.unreachable, lastSweep: 'this run', removed: undefined })
    const backups = await backupsReachability(io, join(skillRoot, '.backups'), [])
    out.push({ id: backups.domain, unit: backups.unit, bound: backups.baseline, used: backups.unreachable, lastSweep: 'this run', removed: undefined })
  }
  const reports = await reportsReachability(io, join(evolutionHome(), 'reports'), [], [])
  out.push({ id: reports.domain, unit: reports.unit, bound: reports.baseline, used: reports.unreachable, lastSweep: 'this run', removed: undefined })
  return out
}
