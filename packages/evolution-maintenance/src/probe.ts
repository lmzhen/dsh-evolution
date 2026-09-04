/**
 * Probe detail computation (011 Phase 3).
 *
 * Pure functions over a skill snapshot — the SAME calculators the scan uses
 * (`duplicateHeadings` / `overlongLines` / `missingSupportPointers` /
 * `narrowNameMatches` / `computeDedupGroups` / `computePrefixClusters`), so a
 * probe result can never disagree with the facts block. No IO, no writes.
 */

import {
  computeDedupGroups,
  computePrefixClusters,
  duplicateHeadings,
  HEALTH_STAMP_RE,
  MIN_STAMP_BODY_CHARS,
  missingSupportPointers,
  narrowNameMatches,
  overlongLines,
  type DriftSkillSnapshot,
} from '@deepseek-ai/dsh-evolution-core'

export const PROBE_SIGNALS: ReadonlyArray<string> = [
  'dedup_group',
  'prefix_cluster',
  'usage_observed',
  'stamp_density',
  'body_size',
  'dup_heading',
  'overlong_line',
  'pointer_missing',
  'narrow_name',
  'description_chars',
  'quality_low',
]

export interface ProbeResult {
  signal: string
  /** Present only when the query carried a target. */
  target?: string
  detail: string[]
}

function result(signal: string, detail: string[], target?: string): ProbeResult {
  return target ? { signal, target, detail } : { signal, detail }
}

function findSnapshot(snapshots: ReadonlyArray<DriftSkillSnapshot>, name: string): DriftSkillSnapshot | undefined {
  return snapshots.find(snapshot => snapshot.name === name)
}

/**
 * Compute probe details for a query. Skill-level signals require `target`;
 * library-level signals ignore it. Unknown signals yield an explicit
 * `unknown-signal` detail (never a fabricated verdict).
 */
export function computeProbe(
  signal: string,
  target: string | undefined,
  snapshots: ReadonlyArray<DriftSkillSnapshot>,
): ProbeResult {
  if (!PROBE_SIGNALS.includes(signal)) {
    return result(signal, [`unknown-signal '${signal}' (allowed: ${PROBE_SIGNALS.join(', ')})`], target)
  }

  if (signal === 'dedup_group') {
    const groups = computeDedupGroups({
      contents: new Map(snapshots.map(snapshot => [snapshot.name, snapshot.body])),
    })
    return result(signal, groups.map(group => group.join(' ~ ')))
  }

  if (signal === 'prefix_cluster') {
    const clusters = computePrefixClusters(snapshots.map(snapshot => snapshot.name))
    return result(signal, clusters.map(cluster => `${cluster.key}: ${cluster.members.join(', ')}`))
  }

  if (signal === 'usage_observed') {
    // Same source as the facts block (computeDriftSignals): all snapshots
    // carrying a definite value decide observed/unobserved; a missing value
    // (no enrichment) is 'unknown' — the probe must not conflate a definite
    // 'unobserved' with 'unknown' (E-36).
    const allProvided = snapshots.length > 0
      && snapshots.every(snapshot => snapshot.usageObserved !== null && snapshot.usageObserved !== undefined)
    if (!allProvided) return result(signal, ['usage_observed=unknown'])
    const observed = snapshots.every(snapshot => snapshot.usageObserved === true)
    return result(signal, [`usage_observed=${observed ? 'observed' : 'unobserved'}`])
  }

  if (!target) return result(signal, ['skill-level signal requires a target skill name'])
  const snapshot = findSnapshot(snapshots, target)
  if (!snapshot) return result(signal, [`skill '${target}' not found in snapshot`], target)

  const body = snapshot.body
  switch (signal) {
    case 'stamp_density': {
      // Same gate as the facts block (MIN_STAMP_BODY_CHARS): a short body with
      // a few dates/shas is ordinary documentation, not log-like content — the
      // probe must report below-min-body instead of a misleading numeric
      // density (E-36/E-36a).
      if (body.length < MIN_STAMP_BODY_CHARS) {
        return result(signal, [
          'stamp_density=below-min-body',
          `body=${body.length} chars below MIN_STAMP_BODY_CHARS=${MIN_STAMP_BODY_CHARS}`,
        ], target)
      }
      const kb = Math.max(1, body.length / 1024)
      const stamps = (body.match(HEALTH_STAMP_RE) ?? [])
      const density = stamps.length / kb
      return result(signal, [
        `stamp_density=${density.toFixed(2)}/KB (${stamps.length} stamps / ${Math.round(kb)}KB)`,
        ...stamps.slice(0, 10).map(stamp => `stamp: ${stamp}`),
      ], target)
    }
    case 'body_size':
      return result(signal, [`body=${body.length} chars`], target)
    case 'dup_heading': {
      const dupes = duplicateHeadings(body)
      return result(signal, dupes.map(d => `${d.heading} x${d.count}`), target)
    }
    case 'overlong_line': {
      const long = overlongLines(body)
      return result(signal, long.map(line => `line ${line.lineNo}: ${line.chars} chars`), target)
    }
    case 'pointer_missing': {
      const missing = missingSupportPointers(body, snapshot.supportFiles ?? [])
      return result(signal, missing.map(path => `no body reference: ${path}`), target)
    }
    case 'narrow_name': {
      const matches = narrowNameMatches(snapshot.name)
      return result(signal, matches.map(shape => `narrow shape: ${shape}`), target)
    }
    case 'description_chars': {
      const desc = snapshot.description
      if (desc === undefined) return result(signal, ['description=missing'], target)
      // 0.3.11: the description text is the only way to exercise the §5-B5
      // nature triage on a skill the auditor cannot read — truncate at 160
      // chars with an explicit marker (truncated judgment must stay ≤0.4).
      const truncated = desc.length > 160
      const text = truncated ? `${desc.slice(0, 160)}…(truncated: ${desc.length} total)` : desc
      return result(signal, [`description=${desc.length} chars`, `desc-text: ${text}`], target)
    }
    case 'quality_low': {
      const quality = snapshot.quality
      return result(signal, [quality === null || quality === undefined ? 'quality=unknown' : `quality=${quality.toFixed(2)}`], target)
    }
    default:
      return result(signal, [`unsupported skill-level signal "${signal}"`], target)
  }
}
