/**
 * `/evolution doctor` — read-only self-check (0.3.55, WB2).
 *
 * Turns "what the README would explain" into "the tool tells you directly":
 * install form, three-way conflict detection (all/host/preset + layered,
 * including preset-bundle × layered via the preset's delivered agent.cordis.yml), the
 * environment surfaces that bit us before (v10 P2-12/13), and which evolution
 * services are actually mounted in this runtime. Always ends with suggested
 * actions so any finding carries its next step.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { evolutionRoot } from '@deepseek-ai/dsh-evolution-core'

/** D-6 (v18): exact-segment tail match (the loose substring form matched a
 * hypothetical `dsh-evolution-allowlist`). */
const tailOf = (name: string): string => name.slice(name.lastIndexOf('/') + 1)
const EVOLUTION_BUNDLE_TAILS = new Set(['dsh-evolution-all', 'dsh-evolution-host', 'dsh-evolution-preset'])

export interface DoctorReport {
  installForm: 'full' | 'host' | 'preset' | 'layered' | 'none'
  /** Aggregated across ALL profiles under `home` (N13, v12): doctor answers
   * "is any profile carrying an evolution bundle / which install forms exist"
   * — not "what this runtime mounted". `services.review` is the runtime-side
   * counterpart (inferred from the install form, P0-1) and may disagree on a
   * multi-profile machine; the render marks the aggregation explicitly. */
  bundles: string[]
  conflicts: string[]
  envIssues: string[]
  services: { review: boolean; curator: boolean; approval: boolean; skillUsage: boolean; io: boolean }
  pendingCount: number | null
  /** v23 (AP-2): claimed-but-crashed records — the only state that needs an
   * operator action (reject) to clear; surfaced separately from pending. */
  executingCount: number | null
  actions: string[]
}

/** Profile bundle rows for evolution-family packages across all profiles.
 *
 * `onReadError` reports a profile whose manifest could not be READ or PARSED.
 * Like the directory-enumeration failure, it is fail-closed at every caller:
 * a truncated manifest is indistinguishable from "no bundles" by the returned
 * list alone, and treating it as "no bundles" is exactly the fail-open state
 * the double-mount exclusion exists to prevent. */
export function collectEvolutionBundles(home: string, onReadError?: (error: unknown, scope: 'profiles-dir' | 'profile-manifest') => void): string[] {
  const profilesDir = join(home, 'profiles')
  if (!existsSync(profilesDir)) return []
  const bundles: string[] = []
  // v29 CMD-04: the directory enumeration itself is guarded — a `profiles`
  // entry that is a FILE (ENOTDIR on readdir) or an unreadable home (EACCES)
  // used to throw out of every caller (doctor, the preset-install refusal
  // gate) instead of degrading to "no bundles seen". Per-profile manifest
  // failures used to be swallowed entirely; they are now reported through the
  // SAME channel (see `onReadError` and the per-profile catch below).
  let profileEntries: Dirent[]
  try {
    profileEntries = readdirSync(profilesDir, { withFileTypes: true })
  } catch (error) {
    // v30 CMD-06: the enumeration failure is now REPORTABLE. The silent `[]`
    // made the preset-install mutual-exclusion gate fail OPEN (an unreadable
    // profiles dir looked like "no bundles" and the double-mounted install
    // proceeded) and doctor rendered a confident `bundles: (none)`.
    onReadError?.(error, 'profiles-dir')
    return bundles
  }
  for (const profile of profileEntries) {
    if (!profile.isDirectory()) continue
    // v34 INST-01: the per-profile manifest failure is fail-closed on the same
    // channel as the enumeration failure. A torn/truncated `package.json`
    // (INST-01's exact corruption) parsed as "no bundles in this profile", so
    // a home whose ONE profile declared `dsh-evolution-all` reported
    // `bundles: (none)` and the preset-install mutual-exclusion gate let the
    // double-mounted install through. A manifest that cannot be read is not
    // evidence of absence — report it and let each caller decide.
    try {
      const manifest = JSON.parse(readFileSync(join(profilesDir, profile.name, 'package.json'), 'utf8')) as {
        dsh?: { profile?: { bundles?: string[] } }
      }
      for (const name of manifest.dsh?.profile?.bundles ?? []) {
        if (EVOLUTION_BUNDLE_TAILS.has(tailOf(name))) bundles.push(name)
      }
    } catch (error) {
      onReadError?.(error, 'profile-manifest')
    }
  }
  return bundles
}

const SESSION_QUERY_MODES = new Set(['startup', 'first-search', 'never'])

function envIssues(): string[] {
  const issues: string[] = []
  const query = process.env.DSH_EVOLUTION_SESSION_QUERY
  if (query && !SESSION_QUERY_MODES.has(query)) {
    issues.push(`DSH_EVOLUTION_SESSION_QUERY="${query}" is not one of startup|first-search|never — the patch normalizes it to 'startup' silently; set it to a listed mode.`)
  }
  return issues
}

/**
 * Diagnose the deployment. `ctx` supplies service presence (a bare stub with
 * only `get` is enough); `home` defaults to the evolution root so tests can
 * point doctor at a temp DSH_HOME.
 */
export async function diagnose(
  ctx: { get(name: string): unknown },
  options: { home?: string } = {},
): Promise<DoctorReport> {
  const home = options.home ?? evolutionRoot()
  const conflicts: string[] = []
  const bundles = collectEvolutionBundles(home, (error, scope) => {
    // v30 CMD-06: the degraded enumeration must be visible — a silent `[]`
    // rendered as `bundles: (none)` hid exactly the double-mount conflicts
    // this report exists to surface.
    // v34 INST-01: the same rule now covers a per-profile manifest that could
    // not be read or parsed — a truncated manifest read as "this profile has no
    // bundles", the identical fail-open direction.
    const detail = error instanceof Error ? error.message : String(error)
    conflicts.push(scope === 'profiles-dir'
      ? `the home profiles directory could not be enumerated (${detail}) — bundle-based install-form and conflict checks are DEGRADED and may miss installed bundles`
      : `a profile manifest could not be read or parsed (${detail}) — this profile's bundle rows are UNKNOWN, so the install-form and conflict checks are DEGRADED and may miss installed bundles`)
  })
  const has = (name: string) => ctx.get(name) !== undefined

  const full = bundles.some(name => tailOf(name) === 'dsh-evolution-all')
  const host = bundles.some(name => tailOf(name) === 'dsh-evolution-host')
  const preset = bundles.some(name => tailOf(name) === 'dsh-evolution-preset')
  const presetDir = join(home, '.agent-presets', 'evolution')
  // V25-07/V26-02 (v25/v26): the layered side is detected by its DELIVERED
  // ARTIFACT (`agent.cordis.yml`, the file `/evolution preset install` and the
  // layered installer both write) rather than bare directory existence — an
  // empty or stale leftover directory must not report a layered install or
  // flag a healthy deployment. ONE detection feeds installForm AND every
  // layered conflict row.
  const presetDirInstalled = existsSync(join(presetDir, 'agent.cordis.yml'))
  const layered = host && presetDirInstalled

  if (full && host) conflicts.push('evolution-all and evolution-host are installed together — the infra rows double-mount and startup fails loud. Keep ONE: remove the other bundle.')
  if (full && preset) conflicts.push('evolution-all and evolution-preset are installed together — the infra rows double-mount. Keep ONE.')
  if (host && preset) conflicts.push('evolution-host and evolution-preset are installed together — the infra rows double-mount. Keep ONE.')
  // V27 G6.4: the conflict is the DELIVERED preset artifact, not the
  // host+preset `layered` form — `all` mounts the same four model rows at
  // profile root, so `all` + a preset directory double-mounts them even when
  // the host bundle is absent (the old `full && layered` condition required
  // host and stayed silent for exactly that combination).
  if (full && presetDirInstalled) conflicts.push('evolution-all and the layered Evolution preset are both present — the model rows double-mount. Keep ONE (use layered without all, or drop the preset).')
  // V24-11 (v24): the preset BUNDLE mounts the same four model rows as `all`
  // (tool-memory / tool-skill-manage / tool-session-query / skill-catalog),
  // so bundle × layered preset dir is the same double-mount as all × layered
  // — but `layered` requires `host`, so this combination used to pass the
  // matrix silently (installForm even reports the healthy 'preset') and a
  // user following the M4 steps on top of the one-click bundle got no
  // conflict at all.
  if (preset && presetDirInstalled) conflicts.push('evolution-preset and the layered Evolution preset are both present — the model rows double-mount (the preset bundle carries the same model rows as all). Keep ONE (drop the preset bundle, or remove the layered preset).')

  // P0-1 fix (v11): `evolutionReview` is NOT a provided service — review only
  // registers session-event hooks. Infer its presence from the install form
  // (any of the three bundles carries the review row) instead of a ghost key.
  const reviewMounted = full || host || preset
  const services = {
    review: reviewMounted,
    curator: has('evolutionCurator'),
    approval: has('evolutionApproval'),
    skillUsage: has('skillUsage'),
    io: has('evolutionIo'),
  }

  let pendingCount: number | null = null
  let executingCount: number | null = null
  const approvalService = ctx.get('evolutionApproval') as { list?: (status: string) => Promise<unknown[]> } | undefined
  if (approvalService?.list) {
    try {
      const rows = await approvalService.list('pending')
      pendingCount = Array.isArray(rows) ? rows.length : null
      // v23 (AP-2): 'executing' is the one state that can NOT resolve itself —
      // a claimed-but-crashed approve is only ever cleared by an operator
      // reject. Hiding it made doctor report "pending: 0" while a stuck
      // record sat in the queue (visible only via /evolution pending).
      const executing = await approvalService.list('executing')
      executingCount = Array.isArray(executing) ? executing.length : null
    } catch {
      pendingCount = null
      executingCount = null
    }
  }

  const installForm: DoctorReport['installForm'] = full ? 'full' : preset ? 'preset' : layered ? 'layered' : host ? 'host' : 'none'

  const actions: string[] = []
  if (conflicts.length > 0) actions.push('Resolve the conflict first: keep exactly one of evolution-all / evolution-host / evolution-preset / layered.')
  else if (installForm === 'none') actions.push('Install the default full bundle: dsh plugin --profile web add @lmzhen/dsh-evolution-all')
  else if (installForm === 'layered') actions.push('Model tools follow the Evolution preset per session; add @lmzhen/dsh-evolution-all instead if every session should have them.')
  const env = envIssues()
  if (env.length > 0) actions.push('Fix the DSH_EVOLUTION_* variable listed above.')
  if (services.review && !services.curator) actions.push('Curator service is not mounted — automatic curation is off; verify the host/all bundle row set is complete.')
  if (pendingCount === null && services.approval) actions.push('Approval service is mounted but pending listing failed — check the evolution state service.')
  // v23 (AP-2): a stuck EXECUTING record can only be cleared by an operator
  // reject (approve refuses to re-execute it) — surface it as a next step.
  // v29 DOC-02: EXECUTING is also the LIVE claim state of an approve still in
  // flight — the flat "the approving run crashed" story steered operators into
  // rejecting a live run (the F-204 divergence). Dual attribution, matching
  // the pending-view hint and the approve surface.
  if ((executingCount ?? 0) > 0) actions.push(`${executingCount} staged write(s) are EXECUTING (an approve crashed mid-run — or one is still in flight). Inspect with /evolution pending: if you started the approve, verify the landed write and do not reject it; only reject after verifying no write is intended.`)

  return { installForm, bundles, conflicts, envIssues: env, services, pendingCount, executingCount, actions }
}

export function renderDoctorText(report: DoctorReport): string {
  const lines = [
    `Evolution doctor — install form: ${report.installForm}`,
    `bundles (all profiles): ${report.bundles.length > 0 ? report.bundles.join(', ') : '(none)'}`,
    // v29 DOC-01: `review` is INFERRED from installed bundles across all
    // profiles (no runtime probe exists) — the render now says so, per the
    // docblock's promise, so a multi-profile machine cannot pass disk evidence
    // off as a mounted service.
    `services: review=${report.services.review} (inferred from bundles, all profiles) curator=${report.services.curator} approval=${report.services.approval} skillUsage=${report.services.skillUsage} io=${report.services.io}`,
    `pending: ${report.pendingCount === null ? 'unknown' : report.pendingCount}`,
    `executing: ${report.executingCount === null ? 'unknown' : report.executingCount}`,
  ]
  if (report.conflicts.length > 0) lines.push('conflicts:', ...report.conflicts.map(line => `  ! ${line}`))
  if (report.envIssues.length > 0) lines.push('env:', ...report.envIssues.map(line => `  ! ${line}`))
  if (report.actions.length > 0) lines.push('next steps:', ...report.actions.map(line => `  → ${line}`))
  return lines.join('\n')
}
