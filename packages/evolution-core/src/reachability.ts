/**
 * G3/3.4: the READ-ONLY reachability reconciliation.
 *
 * Three resource domains have grown past their owners' view: content blobs whose index entries were
 * trimmed away (skill-history: "Trimming drops INDEX entries; orphan blobs stay"), report files no run
 * record points at, and snapshot directories whose manifest holds almost nothing. The audit measured
 * them once (233 blobs / 11.40 MiB / 75.4% unreachable; 52 orphan report .md; 4/5 empty snapshot trees,
 * the newest holding 9 of 35 skills); this module answers the same three questions, from the tree in
 * front of it, and NOTHING ELSE: it deletes nothing, repairs nothing, and adds no timer.
 *
 * Every path is a parameter. The reconciliation must not grow its own idea of where a domain lives -
 * the callers already know (historyRoot / the reports directory / the snapshot root), and a second
 * guess here would be a second owner of that fact.
 */
import { join } from 'node:path'
import { isPresent, isUnknown, probeList, probeText } from './probe.ts'

/** The io surface the reconciliation needs. */
export interface ReachabilityIo {
  list(path: string): Promise<string[]>
  readText(path: string): Promise<string | null>
  exists(path: string): Promise<boolean>
}

/** One domain's reading. `baseline` is the audit's measured value, quoted for comparison, never a target. */
export interface DomainReading {
  readonly domain: string
  readonly unit: 'bytes' | 'files'
  readonly total: number
  readonly reachable: number
  readonly unreachable: number
  /** The audit baseline this line is checked against, verbatim, so a drift is visible without a lookup. */
  readonly baseline: string
  /** Set when a read FAILURE made this domain unmeasurable: not "nothing unreachable", but "not read". */
  readonly unmeasured?: string | undefined
}

const HISTORY_BASELINE = '233 blobs / 11.40 MiB unreachable (75.4%)'
const REPORTS_BASELINE = '52 orphan report .md'
const BACKUPS_BASELINE = '4/5 empty snapshot trees; the newest held 9/35 skills'

/** Every sha256 any skill index references, across the whole history root. */
export async function referencedBlobs(io: ReachabilityIo, historyRoot: string): Promise<Set<string> | undefined> {
  const referenced = new Set<string>()
  const skillsDir = join(historyRoot, 'skills')
  const namesProbe = await probeList(io, skillsDir)
  // N36: an unreadable skills directory is not "no indexes"; the domain is unmeasurable.
  if (isUnknown(namesProbe)) return undefined
  const names = isPresent(namesProbe) ? namesProbe.value : []
  for (const name of names) {
    const probe = await probeText(io, join(skillsDir, name, 'index.json'))
    // N36: a read FAILURE is not "no references" - it makes the domain unmeasurable, and the caller says so.
    if (isUnknown(probe)) return undefined
    // N36: `probe === null` was never true - `Probe<T>` is a wrapper, not `T | null`. The absent case is the
    // wrapper state, so an ABSENT index is skipped while an UNKNOWN one already returned above.
    if (!isPresent(probe)) continue
    for (const match of probe.value.matchAll(/[a-f0-9]{64}/g)) referenced.add(match[0])
  }
  return referenced
}

/**
 * The history domain: blobs on disk minus the blobs the indexes still reference.
 * @param io - the tree reader.
 * @param historyRoot - the history root (`.history`), passed in, never guessed.
 * @returns the reading, with the audit baseline quoted for comparison.
 */
export async function historyReachability(io: ReachabilityIo, historyRoot: string): Promise<DomainReading> {
  const blobsDir = join(historyRoot, 'blobs')
  const blobsProbe = await probeList(io, blobsDir)
  const referenced = await referencedBlobs(io, historyRoot)
  // N36: neither half may turn a read failure into a number. An unreadable blob directory or an
  // unreadable index makes the domain unmeasured - "not read" is not "nothing unreachable".
  if (isUnknown(blobsProbe) || referenced === undefined) {
    return { domain: 'history.blobs', unit: 'bytes', total: 0, reachable: 0, unreachable: 0, baseline: HISTORY_BASELINE, unmeasured: 'a blob listing or an index read failed; this domain was not measured' }
  }
  const blobs = isPresent(blobsProbe) ? blobsProbe.value : []
  const reachable = blobs.filter(blob => referenced.has(blob)).length
  return {
    domain: 'history.blobs',
    unit: 'bytes',
    total: blobs.length,
    reachable,
    unreachable: blobs.length - reachable,
    baseline: HISTORY_BASELINE,
  }
}

/**
 * The reports domain: files no run record points at. A record WITHOUT a `resultRef` still owns the
 * conventional path (`reports/maintain-<id>.json`), so that path counts as reachable - counting only
 * explicit refs would report compliant files as orphans and the number could never match the baseline.
 * @param io - the tree reader.
 * @param reportsDir - the reports directory, passed in.
 * @param runIds - every run id the run records carry.
 * @param resultRefs - every explicit resultRef those records carry.
 */
export async function reportsReachability(io: ReachabilityIo, reportsDir: string, runIds: readonly string[], resultRefs: readonly string[]): Promise<DomainReading> {
  const listed = await probeList(io, reportsDir)
  if (isUnknown(listed)) {
    return { domain: 'reports.files', unit: 'files', total: 0, reachable: 0, unreachable: 0, baseline: REPORTS_BASELINE, unmeasured: 'the reports directory could not be listed; this domain was not measured' }
  }
  const files = isPresent(listed) ? listed.value : []
  const reachableNames = new Set<string>()
  for (const ref of resultRefs) reachableNames.add(ref.slice(ref.lastIndexOf('/') + 1))
  for (const id of runIds) reachableNames.add('maintain-' + id + '.json')
  const reachable = files.filter(file => reachableNames.has(file)).length
  return {
    domain: 'reports.files',
    unit: 'files',
    total: files.length,
    reachable,
    unreachable: files.length - reachable,
    baseline: REPORTS_BASELINE,
  }
}

/**
 * The backups domain: snapshot trees and how much each holds. `skillsPerSnapshot` is measured by the
 * caller (it already reads manifests); an empty tree is one whose manifest lists no skill.
 * @param io - the tree reader.
 * @param backupsRoot - the snapshot root, passed in.
 * @param skillsPerSnapshot - the caller's manifest reading, one entry per snapshot directory.
 */
export async function backupsReachability(io: ReachabilityIo, backupsRoot: string, skillsPerSnapshot: readonly number[]): Promise<DomainReading> {
  const listed = await probeList(io, backupsRoot)
  if (isUnknown(listed)) {
    return { domain: 'backups.trees', unit: 'files', total: 0, reachable: 0, unreachable: 0, baseline: BACKUPS_BASELINE, unmeasured: 'the snapshot root could not be listed; this domain was not measured' }
  }
  const dirs = isPresent(listed) ? listed.value : []
  const empty = skillsPerSnapshot.filter(count => count === 0).length
  return {
    domain: 'backups.trees',
    unit: 'files',
    total: dirs.length,
    reachable: dirs.length - empty,
    unreachable: empty,
    baseline: BACKUPS_BASELINE,
  }
}
