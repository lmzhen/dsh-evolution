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

import { assessStructureHealth, DEFAULT_HEALTH_THRESHOLDS, MIN_STAMP_BODY_CHARS } from './skill-health.ts'
import { computeDedupGroups, computePrefixClusters, LOW_QUALITY_THRESHOLD } from './quality.ts'
import { AUTHORING_DESCRIPTION_BAR } from './constants.ts'

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
}

/** verdict=over means "relatively positioned above the threshold", never a violation. */
export type DriftVerdict = 'pass' | 'over' | 'unknown'

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

export interface DriftSkillAssessment {
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
export const DRIFT_SIGNALS_VERSION = '1'

/** Render-time nouns for the MAINTAIN_PROMPT placeholders (single vocabulary with the facts block). */
export const DRIFT_SIGNAL_NOUNS: Readonly<Record<string, string>> = {
  dedup_group: '近重复组',
  prefix_cluster: '前缀聚类',
  stamp_density: 'stamp 密度',
  body_size: '正文体量',
  dup_heading: '重复标题',
  overlong_line: '超长行',
  pointer_missing: '缺失指针',
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

/** Duplicate `## heading` occurrences: singleton results default to head of the file. */
export function duplicateHeadings(body: string): Array<{ heading: string; count: number }> {
  const counts = new Map<string, number>()
  for (const line of body.split('\n')) {
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
    const length = (lines[index] ?? '').length
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
  library.push(
    dedup.length === 0
      ? sig('dedup_group', 'pass', 'none', 'size >= 2')
      : sig('dedup_group', 'over', dedup.map(group => group.join(', ')).join(' | '), 'size >= 2', `members=${dedup.map(group => group.join('|')).join(';')}`),
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
    signals.push(
      density === null
        ? sig('stamp_density', 'pass', body.length < MIN_STAMP_BODY_CHARS ? 'below-min-body' : 'not-assessed')
        : sig(
          'stamp_density',
          density >= DEFAULT_HEALTH_THRESHOLDS.stampDensityPerKb ? 'over' : 'pass',
          `${density.toFixed(2)}/KB`,
          `${DEFAULT_HEALTH_THRESHOLDS.stampDensityPerKb}/KB`,
        ),
    )
    signals.push(
      sig(
        'body_size',
        body.length >= DEFAULT_HEALTH_THRESHOLDS.softBodyChars ? 'over' : 'pass',
        `${body.length}`,
        `${DEFAULT_HEALTH_THRESHOLDS.softBodyChars}`,
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
    signals.push(
      !supportEnumerated
        ? sig('pointer_missing', 'unknown', 'not-enumerated', undefined, 'support files not enumerated')
        : (missing ?? []).length === 0
          ? sig('pointer_missing', 'pass', 'none')
          : sig('pointer_missing', 'over', missing?.join(', ') ?? ''),
    )

    const narrow = narrowNameMatches(snapshot.name)
    signals.push(
      narrow.length === 0
        ? sig('narrow_name', 'pass', 'none')
        : sig('narrow_name', 'over', narrow.join(', '), undefined, `name=${snapshot.name}`),
    )

    const description = snapshot.description
    signals.push(
      description === undefined
        ? sig('description_chars', 'unknown', 'missing', '60')
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

/** Convenience: fetch one signal from an assessment or library list. */
export function findDriftSignal(signals: ReadonlyArray<DriftSignal>, id: string): DriftSignal | undefined {
  return signals.find(signal => signal.id === id)
}
