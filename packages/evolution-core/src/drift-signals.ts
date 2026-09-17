/**
 * Library-level drift signals for the maintenance subagent (design 011).
 *
 * Deterministic fact checks over a skill-library snapshot: domain drift
 * (narrow names, near-duplicate groups, prefix clusters) and layer drift
 * (log-like bodies, duplicate headings, overlong lines, missing support-file
 * pointers, description over the authoring bar). Pure functions only — no IO,
 * no LLM, no services. Thresholds are imported from their owning modules
 * (skill-health / quality / skill-store), never duplicated.
 *
 * Distinct from `signals.ts` — the session-level review signal gate.
 */

import { assessStructureHealth, DEFAULT_HEALTH_THRESHOLDS } from './skill-health.ts'
import { computeDedupGroups, computePrefixClusters, LOW_QUALITY_THRESHOLD } from './quality.ts'
import { AUTHORING_DESCRIPTION_BAR, DEFAULT_STALE_AFTER_DAYS, MAX_SKILL_CONTENT_CHARS } from './constants.ts'
import { isFileShapedPath, scanBodyHooks, type CitationReport } from './citations.ts'
import type { BodyCost } from './cost.ts'

/** One skill's library state; the assembler (not this module) reads IO. */
export interface DriftSkillSnapshot {
  name: string
  /** SKILL.md content (frontmatter included). */
  body: string
  /** Frontmatter description, when the assembler parsed it. */
  description?: string | undefined
  /** Support-file relative paths (e.g. `references/x.md`), when known. */
  supportFiles?: readonly string[] | undefined
  /** Quality score 0..1, when the assembler computed it; null/undefined = unknown. */
  quality?: number | null | undefined
  /** Usage observation window status; null/undefined = unknown. */
  usageObserved?: boolean | null | undefined
  /** Protection marker (`bundled`/`hub-installed`/`pinned`), when known (0.3.11). */
  protected?: string | null | undefined
  /** Frontmatter values the strict-YAML platform catalog cannot load (0.3.11). */
  catalogInvalid?: boolean | undefined
  /** Weighted context cost of the body (design §5.2); undefined = not measured. */
  cost?: BodyCost | undefined
  /** Citation scan of the body (design §5.2); undefined = not scanned. */
  citations?: CitationReport | undefined
  /** Per-support-file read counts (design §5.5); undefined = no evidence. */
  demand?: Readonly<Record<string, number>> | undefined
  /** Idle age of the owning skill (design §5.6); undefined = no record to age. */
  liveness?: SkillLiveness | undefined
  /** Character counts of support files that can possibly exceed the content cap
   * (design §16.6, V4); undefined = not measured. The assembler pre-filters by
   * byte size, which is complete for the oversize question. */
  supportChars?: Readonly<Record<string, number>> | undefined
}

/** Retirement-proposal input for one skill (design §5.6). */
export interface SkillLiveness {
  /** Idle days since the lifecycle age anchor (`last activity ?? created_at`). */
  idleDays: number
}

/** verdict=over means "relatively positioned above the threshold", never a violation. */
type DriftVerdict = 'pass' | 'over' | 'unknown'

export interface DriftSignal {
  id: string
  verdict: DriftVerdict
  /** Human-readable measured value; message text is redactable. */
  value: string
  /** Threshold reference, when the signal has one. */
  threshold?: string | undefined
  /** Extra evidence (matched shapes, line numbers, group members). */
  detail?: string | undefined
}

interface DriftSkillAssessment {
  name: string
  signals: ReadonlyArray<DriftSignal>
  /** Passthrough from the snapshot (0.3.11): protection marker, catalog loadability. */
  protected?: string | null | undefined
  catalogInvalid?: boolean | undefined
}

export interface DriftReport {
  /** Library-wide signals (dedup_group, prefix_cluster, usage_observed). */
  library: ReadonlyArray<DriftSignal>
  /** Per-skill signals. */
  skills: ReadonlyArray<DriftSkillAssessment>
}

/** Physical line length at/above which a body line is reported overlong (011 §4). */
export const DRIFT_MAX_LINE_CHARS = 1_500

/** Signal-set version: bump whenever ids/thresholds change (011 §7 version coupling). */
export const DRIFT_SIGNALS_VERSION = '3'

/** Render-time nouns for the MAINTAIN_PROMPT placeholders (single vocabulary with the facts block). */
export const DRIFT_SIGNAL_NOUNS: Readonly<Record<string, string>> = {
  dedup_group: '近重复组',
  prefix_cluster: '前缀聚类',
  stamp_density: 'stamp 密度',
  body_size: '正文体量',
  dup_heading: '重复标题',
  overlong_line: '超长行',
  pointer_missing: '缺失指针',
  citation_resolution: '引用解析',
  demand: '需求证据',
  description_chars: '描述长度',
  narrow_name: '窄名',
  usage_observed: '使用观察',
  quality_low: '质量分',
}

const NARROW_NAME_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'error-string', re: /^(?:err|error|exception|traceback|warn|fail)(?:[-_][a-z0-9]+)+$/i },
  { label: 'pr-number', re: /^(?:pr|issue)[-_]?\d{2,}$/i },
  { label: 'dated', re: /\d{4}-\d{2}-\d{2}/ },
  { label: 'session-verb', re: /^(?:fix|debug|audit|salvage|diagnose|investigate)[-_][a-z0-9-]+$/i },
]

/** Detect support files the body never references (by basename or relative path). */
export function missingSupportPointers(body: string, supportFiles: readonly string[]): string[] {
  return supportFiles.filter((path) => {
    const base = path.split('/').pop() ?? path
    return base.length > 0 && !body.includes(base) && !body.includes(path)
  })
}

/** Support files the body mentions WITHOUT the sanctioned hook form (design
 * §5.6). Such a mention still counts as a pointer for `pointer_missing`, but
 * only the hook form keeps the file discoverable after a move — detail only.
 * A file carrying a `keep` marker is exempt: its mention IS the marker. */
export function unhookedSupportPointers(body: string, supportFiles: readonly string[]): string[] {
  const { targets, kept } = scanBodyHooks(body)
  const hooked = new Set(targets)
  return supportFiles.filter((path) => {
    if (!isFileShapedPath(path)) return false
    const base = path.split('/').pop() ?? path
    if (kept.has(path) || (base.length > 0 && kept.has(base))) return false
    const mentioned = (base.length > 0 && body.includes(base)) || body.includes(path)
    return mentioned && !hooked.has(path) && !hooked.has(base)
  })
}

/** Why a retirement report lists nothing (design §5.6). */
export type RetirementStatus = 'listed' | 'none' | 'no-age' | 'unscanned'

/** One support file proposed for retirement review. */
export interface RetirementCandidate {
  path: string
  /** Whole idle days of the owning skill at scan time. */
  idleDays: number
}

/** Retirement proposal for one skill: candidates plus the reason when empty. */
export interface RetirementReport {
  candidates: readonly RetirementCandidate[]
  status: RetirementStatus
}

/** Support files with no readers, no citations and no `keep` marker whose owning
 * skill has been idle for at least the lifecycle stale window. PROPOSAL INPUT
 * only — nothing retires a file on its own — and an unmeasurable input (no age
 * evidence, no citation scan) yields an empty list WITH its reason, never a
 * silent "nothing qualifies".
 * @param snapshot - the skill's drift snapshot.
 * @param supportFiles - its enumerated support files, in listing order.
 * @returns the candidates plus the status that explains an empty list.
 */
export function retirementReport(snapshot: DriftSkillSnapshot, supportFiles: readonly string[]): RetirementReport {
  const idle = snapshot.liveness?.idleDays
  if (idle === undefined) return { candidates: [], status: 'no-age' }
  if (snapshot.citations === undefined) return { candidates: [], status: 'unscanned' }
  if (idle < DEFAULT_STALE_AFTER_DAYS) return { candidates: [], status: 'none' }
  const cited = new Set<string>()
  for (const ref of snapshot.citations.refs) {
    if (ref.kind === 'citation' && ref.target !== null) cited.add(ref.target)
  }
  const { kept } = scanBodyHooks(snapshot.body)
  const demand = snapshot.demand ?? {}
  const candidates = supportFiles
    .filter(path => isFileShapedPath(path) && (demand[path] ?? 0) === 0 && !cited.has(path) && !kept.has(path))
    .map(path => ({ path, idleDays: Math.floor(idle) }))
  return { candidates, status: candidates.length === 0 ? 'none' : 'listed' }
}

/** Duplicate `## heading` occurrences: singleton results default to head of the file. */
export function duplicateHeadings(body: string): Array<{ heading: string; count: number }> {
  const counts = new Map<string, number>()
  // S1.8 (v37 P1-14): scan the CR-stripped view — `.` never matches `\r` and a
  // non-multiline `$` only anchors at the end of the input, so a CRLF body made
  // every heading line unmatchable and `dup_heading` reported a FALSE `pass`
  // (the maintenance prompt then never asked for the merge).
  for (const raw of body.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const m = /^##\s+(.+)$/.exec(line)
    if (m?.[1]) {
      const heading = m[1].trim()
      if (heading) counts.set(heading, (counts.get(heading) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([heading, count]) => ({ heading, count }))
}

/** Physical lines over `max` characters: `{ lineNo, chars }`, 1-based line numbers. */
export function overlongLines(body: string, max = DRIFT_MAX_LINE_CHARS): Array<{ lineNo: number; chars: number }> {
  const out: Array<{ lineNo: number; chars: number }> = []
  const lines = body.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    // S1.8 (v37 P2-3): the CR is a line terminator, not a visible character — a
    // 1500-character CRLF line used to report 1501 and send the model after a
    // line that already complies.
    const raw = lines[index] ?? ''
    const length = raw.endsWith('\r') ? raw.length - 1 : raw.length
    if (length > max) out.push({ lineNo: index + 1, chars: length })
  }
  return out
}

/** Narrow-name shapes detected in a skill name (empty = none). */
export function narrowNameMatches(name: string): string[] {
  return NARROW_NAME_PATTERNS.filter(({ re }) => re.test(name)).map(({ label }) => label)
}

function supportGroupCount(supportFiles: readonly string[] | undefined): number {
  const groups = new Set<string>()
  for (const path of supportFiles ?? []) {
    const head = path.split('/')[0]
    if (head) groups.add(head)
  }
  return groups.size
}

function sig(id: string, verdict: DriftVerdict, value: string, threshold?: string, detail?: string): DriftSignal {
  return { id, verdict, value, threshold, detail }
}

/**
 * Compute all drift signals for a snapshot. Missing inputs (quality score,
 * usage window) yield `unknown` — never a fabricated verdict.
 */
export function computeDriftSignals(snapshots: ReadonlyArray<DriftSkillSnapshot>): DriftReport {
  const library: DriftSignal[] = []
  const names = snapshots.map(s => s.name)

  const dedup = computeDedupGroups({
    contents: new Map(snapshots.map(s => [s.name, s.body])),
  })
  // PLAN-R2 P2-8 (2026-09-16): the scan is budget-bounded; a truncated sweep
  // must say so instead of reading as a clean pass.
  const dedupTruncation = dedup.truncated ? ' (dedup scan truncated at the pair-comparison budget)' : ''
  library.push(
    dedup.groups.length === 0
      ? sig('dedup_group', 'pass', `none${dedupTruncation}`, 'size >= 2')
      : sig('dedup_group', 'over', `${dedup.groups.map(group => group.join(', ')).join(' | ')}${dedupTruncation}`, 'size >= 2', `members=${dedup.groups.map(group => group.join('|')).join(';')}`),
  )

  const clusters = computePrefixClusters(names)
  library.push(
    clusters.length === 0
      ? sig('prefix_cluster', 'pass', 'none', 'size >= 2')
      : sig('prefix_cluster', 'over', clusters.map(cluster => cluster.members.join(', ')).join(' | '), 'size >= 2', `key=${clusters.map(cluster => cluster.key).join('|')}`),
  )

  const allProvided = snapshots.length > 0 && snapshots.every(s => s.usageObserved !== null && s.usageObserved !== undefined)
  library.push(
    !allProvided
      ? sig('usage_observed', 'unknown', 'not-observed', undefined, 'usage window status missing')
      : snapshots.every(s => s.usageObserved === true)
        ? sig('usage_observed', 'pass', 'observed')
        : sig('usage_observed', 'pass', 'unobserved'),
  )

  const skills: DriftSkillAssessment[] = snapshots.map((snapshot) => {
    const signals: DriftSignal[] = []
    const body = snapshot.body
    const supportFiles = snapshot.supportFiles ?? []
    const supportEnumerated = snapshot.supportFiles !== undefined

    const health = assessStructureHealth(
      {
        skillName: snapshot.name,
        bodyChars: body.length,
        bodyText: body,
        supportGroups: supportGroupCount(supportFiles),
      },
      DEFAULT_HEALTH_THRESHOLDS,
    )
    const density = health.dims.stampDensityPerKb
    // P2-12 (v39): density stays null only for an empty body or one below
    // MIN_STAMP_BODY_CHARS (skill-health.ts gates the measurement there), so
    // 'below-min-body' is the only reachable reason — 'not-assessed' was dead.
    signals.push(
      density === null
        ? sig('stamp_density', 'pass', 'below-min-body')
        : sig(
          'stamp_density',
          density >= DEFAULT_HEALTH_THRESHOLDS.stampDensityPerKb ? 'over' : 'pass',
          `${density.toFixed(2)}/KB`,
          `${DEFAULT_HEALTH_THRESHOLDS.stampDensityPerKb}/KB`,
        ),
    )
    // Cost rides the EXISTING signal as a value dimension (design §5.2): the
    // verdict still follows the character threshold, so adding the metric cannot
    // flip a skill's verdict. The token range is an estimate and says so.
    const cost = snapshot.cost
    signals.push(
      sig(
        'body_size',
        body.length >= DEFAULT_HEALTH_THRESHOLDS.softBodyChars ? 'over' : 'pass',
        cost === undefined ? `${body.length}` : `${body.length} chars / ${cost.units} units`,
        `${DEFAULT_HEALTH_THRESHOLDS.softBodyChars}`,
        cost === undefined
          ? undefined
          // V3: the band is the AUTHORING discipline band (upstream's 20k split
          // line in weighted units), and the multiple is what makes it actionable —
          // a bare ceiling says nothing about how far past it the body is.
          : `tokens≈${cost.tokensLow}-${cost.tokensHigh} (estimate; cjk=${cost.cjk}; band=${DEFAULT_HEALTH_THRESHOLDS.softBodyCostUnits} units, body=${(cost.units / DEFAULT_HEALTH_THRESHOLDS.softBodyCostUnits).toFixed(1)}x)${oversizeSupportNote(snapshot.supportChars)}`,
      ),
    )

    const dupes = duplicateHeadings(body)
    signals.push(
      dupes.length === 0
        ? sig('dup_heading', 'pass', 'none')
        : sig('dup_heading', 'over', dupes.map(d => `${d.heading}(${d.count})`).join(', '), 'count >= 2'),
    )

    const long = overlongLines(body)
    signals.push(
      long.length === 0
        ? sig('overlong_line', 'pass', 'none')
        : sig('overlong_line', 'over', long.map(l => `${l.lineNo}:${l.chars}`).join(', '), `${DRIFT_MAX_LINE_CHARS}`),
    )

    const missing = supportEnumerated ? missingSupportPointers(body, supportFiles) : undefined
    // Hook coverage rides the EXISTING signal as detail (design §5.6): a file
    // mentioned without the sanctioned hook form is still pointed at, so the
    // verdict stays with `missingSupportPointers`.
    const unhooked = supportEnumerated ? unhookedSupportPointers(body, supportFiles) : []
    const unhookedDetail = unhooked.length === 0
      ? undefined
      : `unhooked=${unhooked.length}: ${unhooked.slice(0, 5).join(', ')}`
    signals.push(
      !supportEnumerated
        ? sig('pointer_missing', 'unknown', 'not-enumerated', undefined, 'support files not enumerated')
        : (missing ?? []).length === 0
          ? sig('pointer_missing', 'pass', 'none', undefined, unhookedDetail)
          : sig('pointer_missing', 'over', missing?.join(', ') ?? '', undefined, unhookedDetail),
    )

    signals.push(citationSignal(snapshot.citations))
    signals.push(demandSignal(snapshot, supportFiles, supportEnumerated))

    const narrow = narrowNameMatches(snapshot.name)
    signals.push(
      narrow.length === 0
        ? sig('narrow_name', 'pass', 'none')
        : sig('narrow_name', 'over', narrow.join(', '), undefined, `name=${snapshot.name}`),
    )

    const description = snapshot.description
    signals.push(
      description === undefined
        // C-21 (v10 audit): the threshold renders from the constant like the
        // assessed branch below — the hardcoded '60' could drift from
        // AUTHORING_DESCRIPTION_BAR.
        ? sig('description_chars', 'unknown', 'missing', `${AUTHORING_DESCRIPTION_BAR}`)
        : sig(
          'description_chars',
          description.length > AUTHORING_DESCRIPTION_BAR ? 'over' : 'pass',
          `${description.length}`,
          `${AUTHORING_DESCRIPTION_BAR}`,
        ),
    )

    const quality = snapshot.quality
    signals.push(
      quality === null || quality === undefined
        ? sig('quality_low', 'unknown', 'not-assessed')
        : sig('quality_low', quality < LOW_QUALITY_THRESHOLD ? 'over' : 'pass', quality.toFixed(2), `${LOW_QUALITY_THRESHOLD}`),
    )

    return {
      name: snapshot.name,
      signals,
      ...(snapshot.protected !== undefined && snapshot.protected !== null ? { protected: snapshot.protected } : {}),
      ...(snapshot.catalogInvalid !== undefined ? { catalogInvalid: snapshot.catalogInvalid } : {}),
    }
  })

  return { library, skills }
}

/** Dangling-citation verdict: a partial scan is `unknown`, never a clean pass. */
function citationSignal(citations: CitationReport | undefined): DriftSignal {
  if (citations === undefined) return sig('citation_resolution', 'unknown', 'not-scanned', undefined, 'support-file list missing')
  if (citations.truncated) return sig('citation_resolution', 'unknown', `truncated at ${citations.refs.length} refs`, undefined, 'partial scan — not a clean verdict')
  const cited = citations.refs.filter(ref => ref.kind === 'citation')
  if (citations.dangling.length > 0) {
    const missing = citations.dangling.slice(0, 5).map(ref => ref.target ?? ref.raw).join(', ')
    return sig('citation_resolution', 'over', `dangling=${citations.dangling.length}/${cited.length}`, 'dangling=0', `missing: ${missing}`)
  }
  return sig('citation_resolution', 'pass', `citations=${cited.length} foreign=${citations.foreign.length}${citations.unverified.length === 0 ? '' : ` unverified=${citations.unverified.length}`}`)
}

/** V4 (design §16.6): the report half of the support-file cap. Only files the
 * assembler could PROVE large enough to be over the cap are namespaced here; an
 * absent map claims nothing (unknown is not zero).
 * @param supportChars - measured character counts, or undefined when unmeasured.
 * @returns a detail suffix naming the oversize files, or an empty string.
 */
function oversizeSupportNote(supportChars: Readonly<Record<string, number>> | undefined): string {
  if (supportChars === undefined) return ''
  const oversize = Object.entries(supportChars)
    .filter(([, chars]) => chars > MAX_SKILL_CONTENT_CHARS)
    .sort((a, b) => b[1] - a[1])
  if (oversize.length === 0) return ''
  const shown = oversize.slice(0, 3).map(([path, chars]) => `${path}(${chars})`)
  return `; oversize support file(s): ${shown.join(', ')}${oversize.length > shown.length ? ' …' : ''}`
}

/** Render-time reason for an empty retirement list (design §5.6). */
const RETIREMENT_STATUS_TEXT: Readonly<Record<RetirementStatus, string>> = {
  listed: 'listed',
  none: 'none',
  'no-age': 'age unknown',
  unscanned: 'citations unscanned',
}

/** Cold-support-file verdict (design §5.5): zero reads are evidence only while
 * the observation window is open and the file list is known. */
function demandSignal(
  snapshot: DriftSkillSnapshot,
  supportFiles: readonly string[],
  supportEnumerated: boolean,
): DriftSignal {
  if (!supportEnumerated || supportFiles.length === 0) {
    return sig('demand', 'unknown', 'not-enumerated', undefined, 'support files not enumerated')
  }
  if (snapshot.usageObserved !== true) {
    return sig('demand', 'unknown', 'window-closed', undefined, 'no observed reads yet: zero is not evidence')
  }
  const demand = snapshot.demand ?? {}
  const cold = supportFiles.filter(path => (demand[path] ?? 0) === 0)
  // Retirement evidence rides the SAME signal as detail: it narrows "cold" to
  // "cold AND uncited AND old enough AND not kept" without moving the verdict.
  const retire = retirementReport(snapshot, supportFiles)
  const retireDetail = retire.candidates.length === 0
    ? `retire: ${RETIREMENT_STATUS_TEXT[retire.status]}`
    : `retire≥${DEFAULT_STALE_AFTER_DAYS}d: ${retire.candidates.slice(0, 5).map(c => `${c.path}(${c.idleDays}d)`).join(', ')}`
  if (cold.length === 0) return sig('demand', 'pass', `${supportFiles.length} warm`, 'cold=0', retireDetail)
  const sample = cold.slice(0, 5).join(', ')
  return sig('demand', 'over', `cold=${cold.length}/${supportFiles.length}`, 'cold=0', `never read: ${sample} · ${retireDetail}`)
}

/** Convenience: fetch one signal from an assessment or library list. */
export function findDriftSignal(signals: ReadonlyArray<DriftSignal>, id: string): DriftSignal | undefined {
  return signals.find(signal => signal.id === id)
}
