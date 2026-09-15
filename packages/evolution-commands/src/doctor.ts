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
import { fileURLToPath } from 'node:url'
import { composePresetComposition, evolutionRoot, scopedProbeReport, type ScopedProbeReport } from '@deepseek-ai/dsh-evolution-core'

/** D-6 (v18): exact-segment tail match (the loose substring form matched a
 * hypothetical `dsh-evolution-allowlist`). */
const tailOf = (name: string): string => name.slice(name.lastIndexOf('/') + 1)
const EVOLUTION_BUNDLE_TAILS = new Set(['dsh-evolution-all', 'dsh-evolution-host', 'dsh-evolution-preset'])

/** G3-② (B2): one delivered preset variant compared against a fresh generation.
 * "absent" is the user simply not using that base (never an action); "unknown"
 * is a comparison that could not run, kept distinct from a verified "fresh". */
export interface PresetFreshnessRow {
  /** Agent-preset base name (the id the platform registry read() takes). */
  base: string
  /** Install destination <home>/.agent-presets/<base.id> that was compared. */
  destination: string
  status: 'fresh' | 'differs' | 'absent' | 'unknown'
  /** Why the comparison could not run — set on unknown rows only. */
  detail?: string
}

/** S0-4 (v43 G-1 / J-1): the session-scoped rows against the runtime witness.
 *
 * The gate has two halves nobody reconciled: the bundle turns `sessionScoped` on
 * for `evolution-review` and `skill-usage`, and the runtime witness knows
 * whether ANY session ever saw the family's model tools. `never-hit` with the
 * rows mounted is a finding — the host-only form mounts no model row at all
 * (tool-memory / tool-skill-manage are devDependencies of evolution-host) and an
 * overlay may disable either row, so review injection and skill-usage telemetry
 * run for nobody. `idle` claims nothing: the gate simply has not been asked yet
 * in this process. Read-only, like every other row of this report. */
export interface ScopedProbeCheck {
  /** The scoped rows the installed bundles mount (`evolution-review`,
   * `skill-usage`); empty when no bundle is installed, and null when a DEGRADED
   * bundle read makes the set undecidable — an unreadable manifest is not
   * evidence of absence (the INST-01 / S2.1 discipline). */
  rows: string[] | null
  /** The runtime witness, verbatim (`scopedProbeReport()`). */
  verdict: ScopedProbeReport['verdict']
  /** Scoped gate evaluations that resolved true. */
  hits: number
  /** Scoped gate evaluations that resolved false. */
  misses: number
}

export interface DoctorReport {
  /** OPT-23 (2026-09): `preset-only` — the delivered Evolution preset
   * artifact exists but NO profile carries an evolution bundle (e.g. the
   * host bundle was removed after a layered install). Before, this healthy
   * per-session install reported `none` and the action ladder advised
   * installing `all` — which double-mounts the preset's model rows (the
   * exact conflict this report flags). */
  installForm: 'full' | 'host' | 'preset' | 'layered' | 'preset-only' | 'none'
  /** The PRODUCT form the install form implies (0.3.77, C axis). `variant` =
   * session-level opt-in: the model tools live in the Evolution preset, so a
   * session on any platform original preset carries none of the family and the
   * cross-session consumers skip it (config `sessionScoped`). `attach` =
   * profile-level: the model rows sit at profile root and every session carries
   * them. The two are mutually exclusive install targets (E-33). */
  deploymentForm: 'variant' | 'attach' | 'host-only' | 'preset-only' | 'none'
  /** Aggregated across ALL profiles under `home` (N13, v12): doctor answers
   * "is any profile carrying an evolution bundle / which install forms exist"
   * — not "what this runtime mounted". `services.review` is the runtime-side
   * counterpart (inferred from the install form, P0-1) and may disagree on a
   * multi-profile machine; the render marks the aggregation explicitly. */
  bundles: string[]
  conflicts: string[]
  envIssues: string[]
  /** S0.2 (v37 P0-1): memory files carrying the platform's `{{` prompt-variable
   * syntax. Residual-risk detector — current builds neutralize the INJECTED text
   * (`MemoryStore.renderContext`), but a still-running older build fails every
   * pre-step of every session under this home, and an operator may want to clean
   * the file regardless. */
  memoryIssues: string[]
  /** S4/P-1+P-2 (platform gap, family mitigation): the session-query corpus
   * listing failed — reported verbatim, with the isolation recipe. Empty when the
   * service is absent or answering. */
  queryIssues: string[]
  /** S2-12③ (FLOW5-4): the memory budget's two configuration surfaces disagree —
   * `memory-files`' store limit vs `evolution-policy`'s planning value. Empty
   * when either surface is absent (nothing to compare) or they agree. */
  budgetIssues: string[]
  services: { review: boolean; curator: boolean; approval: boolean; skillUsage: boolean; io: boolean }
  pendingCount: number | null
  /** v23 (AP-2): claimed-but-crashed records — the only state that needs an
   * operator action (reject) to clear; surfaced separately from pending. */
  executingCount: number | null
  /** G3-② (B2): how the delivered preset variants compare with what a fresh
   * generation would write against THIS runtime platform. A variant embeds the
   * platform composition of its install day, so a platform change or a family
   * upgrade leaves a file describing a platform that no longer exists. Read-only:
   * a stale snapshot is reported, never repaired. */
  presetFreshness: PresetFreshnessRow[]
  /** S0-4 (v43 G-1 / J-1): the scoped rows × the probe witness, so a deployment
   * whose cross-session consumers are inert for every session stops looking
   * healthy. See {@link ScopedProbeCheck}. */
  scopedProbe: ScopedProbeCheck
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
    // S2.1 (v37 P1-3): `profiles/node_modules` is a PLATFORM-created directory
    // (`app-boot` heals the profile module fallback there on every launch) and
    // never carries a manifest. Reading it as a torn profile made every healthy
    // install fail the preset-install exclusion gate and print a fake DEGRADED
    // conflict. Dot-entries are not profiles either.
    if (profile.name === 'node_modules' || profile.name.startsWith('.')) continue
    let raw: string
    try {
      raw = readFileSync(join(profilesDir, profile.name, 'package.json'), 'utf8')
    } catch (error) {
      // ENOENT means "this directory is not a profile", not "a profile manifest
      // is torn" — only a REAL read failure (EACCES/EIO) is fail-closed.
      // v43 S1-4: deliberately NARROWER than core/probe.ts's isMissingPath — in
    // this walk ENOENT means "this directory is not a profile", not "the file I
    // asked for is absent"; ENOTDIR/EACCES must keep failing loud. Do not merge.
      if ((error as { code?: string } | undefined)?.code === 'ENOENT') continue
      onReadError?.(error, 'profile-manifest')
      continue
    }
    try {
      const manifest = JSON.parse(raw) as {
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

/** S0.2 (v37 P0-1): memory files that still carry the platform's `{{` prompt
 * variable syntax. The platform interpolates EVERY `systemPrompt.context` text
 * once per model step and throws on an unknown/malformed reference, so one such
 * entry used to fail every turn of every session under this home. Current
 * builds neutralize the injected text (`MemoryStore.renderContext`), which is
 * why this is a residual-risk report instead of a hard failure: an older
 * still-running process is still bricked, and an operator may prefer to clean
 * the file. Read-only; an unreadable file is skipped (the doctor never throws).
 * @param home - resolved DSH_HOME.
 * @returns one message per affected memory file.
 */
function memoryInterpolationIssues(home: string): string[] {
  const issues: string[] = []
  for (const file of ['MEMORY.md', 'USER.md']) {
    const path = join(home, 'memories', file)
    if (!existsSync(path)) continue
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    const hits = raw.split('{{').length - 1
    if (hits > 0) {
      issues.push(`${file}: ${hits} "{{" occurrence(s) — the platform interpolates this syntax in prompt context and throws on an unknown reference, so a build without the render-time neutralization fails every later turn; rewrite the affected entries`)
    }
  }
  return issues
}

/** G3-② (B2): the family delta container. An optionalDependency of this
 * package, so resolution may legitimately fail; every failure degrades to
 * "unknown" — the doctor never throws.
 * Platform anchor: agentPresets.read(id) — preset/agent-presets/src/index.ts:501. */
const AGENT_PRESET_PACKAGE = '@deepseek-ai/dsh-evolution-agent-preset'

/** Resolve one asset the package declares in its exports map.
 * @param asset - bases.json or agent.cordis.yml.
 * @returns the file path, or null when the package is not installed. */
function resolveAgentPresetAsset(asset: string): string | null {
  try {
    return fileURLToPath(import.meta.resolve(`${AGENT_PRESET_PACKAGE}/${asset}`))
  } catch {
    // Optional dependency absent (or the export renamed): "cannot recompute",
    // which the caller reports as unknown instead of guessing a path.
    return null
  }
}

/** The base rows of bases.json: the comparison iterates the same table the
 * installer reads, so doctor cannot check a different set of variants.
 * S1-F1: rows also carry the optional `unsupported` note — the layered-form
 * detection below must not treat a base that carries NO family model rows
 * (minimal) as a double-mount participant.
 * @param path - resolved bases.json.
 * @returns the rows, or null when the table is unreadable or malformed. */
function readAgentPresetBases(path: string): Array<{ name: string; id: string; unsupported?: string }> | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { bases?: unknown }
    if (!Array.isArray(parsed.bases)) return null
    const rows: Array<{ name: string; id: string; unsupported?: string }> = []
    for (const raw of parsed.bases) {
      const entry = raw as { name?: unknown; id?: unknown; unsupported?: unknown }
      if (typeof entry.name !== 'string' || typeof entry.id !== 'string') return null
      rows.push({ name: entry.name, id: entry.id, ...(typeof entry.unsupported === 'string' ? { unsupported: entry.unsupported } : {}) })
    }
    return rows.length > 0 ? rows : null
  } catch {
    // A missing or torn table is a broken install, not "no bases": the caller
    // reports unknown rather than comparing against an empty expectation.
    return null
  }
}

/** Preset directories already on disk, used to keep an installed variant
 * VISIBLE when the base table itself could not be read.
 * @param root - the .agent-presets directory.
 * @returns the directory names; empty when nothing is installed. */
function installedPresetIds(root: string): string[] {
  const ids: string[] = []
  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    // No .agent-presets yet (or an unreadable one): there is no installed
    // variant to compare, which the caller renders as no rows at all.
    return ids
  }
  for (const entry of entries) if (entry.isDirectory()) ids.push(entry.name)
  return ids
}

/**
 * S1-F1: ids of the family's DELIVERED layered presets — every
 * `.agent-presets/<id>/agent.cordis.yml` artifact that can actually carry the
 * family model rows. The detection used to probe ONLY the default base id
 * (`evolution`), so a `--base ptc|cordis` layered install was invisible:
 * installForm degraded to `none`/`host` and the action ladder recommended
 * installing `evolution-all` on top — the exact double-mount the doctor exists
 * to prevent (V27 G6.4 closed it for the default id only).
 *
 * A directory counts only when the base table names it as a SUPPORTED family
 * base (the `unsupported` minimal base carries no model rows and cannot
 * double-mount anything). When the table itself cannot be read, every
 * delivered artifact counts — the visible-by-directory posture of
 * {@link probePresetFreshness}: flag rather than stay silent.
 * @param root - the `.agent-presets` home directory.
 * @returns installed family base ids whose `agent.cordis.yml` is on disk.
 */
function installedLayeredPresetIds(root: string): string[] {
  const delivered = installedPresetIds(root).filter(id => existsSync(join(root, id, 'agent.cordis.yml')))
  if (delivered.length === 0) return []
  const basesPath = resolveAgentPresetAsset('bases.json')
  const bases = basesPath === null ? null : readAgentPresetBases(basesPath)
  if (bases === null) {
    // S2-O4: table unreadable, so base ids cannot arbitrate — fall back to a
    // content marker instead of counting every delivered directory: a
    // family-generated composition references at least one `@deepseek-ai/dsh-*`
    // package, a foreign preset does not. (Fail-safe posture kept: the marker
    // is cheap, and flagging a doubtful artifact still beats staying silent.)
    return delivered.filter((id) => {
      try {
        return readFileSync(join(root, id, 'agent.cordis.yml'), 'utf8').includes('@deepseek-ai/dsh-')
      } catch {
        return false
      }
    })
  }
  const supported = new Set(bases.filter(row => row.unsupported === undefined).map(row => row.id))
  return delivered.filter(id => supported.has(id))
}

/**
 * G3-② (B2): recompute what a fresh generation would write for every
 * installed variant and compare it byte-for-byte with the file on disk.
 *
 * The recomputation goes through composePresetComposition — the SAME rule
 * /evolution preset install and install-layered.mjs apply (collision guard +
 * row-overrides.json), so doctor cannot disagree with the installer about what
 * "fresh" means. Read-only by contract: the snapshot is never rewritten.
 * @param home - resolved DSH_HOME.
 * @param registry - the platform agent-preset registry, undefined when unmounted.
 * @returns one row per base in the family bases.json.
 */
async function probePresetFreshness(
  home: string,
  registry: { read(id: string): Promise<string> } | undefined,
): Promise<PresetFreshnessRow[]> {
  const presetsRoot = join(home, '.agent-presets')
  const basesPath = resolveAgentPresetAsset('bases.json')
  // The package's OWN delta: DSH_EVOLUTION_DELTA_PATH is documented as a
  // source-installer knob (README), so this session-side comparison must not
  // read it — doctor answers what /evolution preset install would write.
  const deltaPath = resolveAgentPresetAsset('agent.cordis.yml')
  const bases = basesPath === null ? null : readAgentPresetBases(basesPath)
  // The family half of the comparison. Without the delta there is nothing to
  // generate, and the reason travels into every row it blocks.
  let delta: string | null = null
  let deltaFailure = `${AGENT_PRESET_PACKAGE}/agent.cordis.yml could not be resolved — is the family agent-preset package installed?`
  if (deltaPath !== null) {
    try {
      delta = readFileSync(deltaPath, 'utf8')
    } catch (error) {
      deltaFailure = `${deltaPath} could not be read (${error instanceof Error ? error.message : String(error)})`
    }
  }
  if (bases === null) {
    // No table means no base can be NAMED, but an installed variant is still
    // visible by directory — report it as unknown instead of silently clean.
    const tablePath = basesPath ?? `${AGENT_PRESET_PACKAGE}/bases.json`
    return installedPresetIds(presetsRoot).map(id => ({
      base: id,
      destination: join(presetsRoot, id),
      status: 'unknown' as const,
      detail: `the family base table could not be read (${tablePath}) — a fresh generation cannot be recomputed`,
    }))
  }
  const rows: PresetFreshnessRow[] = []
  for (const base of bases) {
    const destination = join(presetsRoot, base.id)
    const compositionPath = join(destination, 'agent.cordis.yml')
    // Not installed is not an error: the user may simply not use this base.
    if (!existsSync(compositionPath)) {
      rows.push({ base: base.name, destination, status: 'absent' })
      continue
    }
    if (registry === undefined) {
      rows.push({ base: base.name, destination, status: 'unknown', detail: 'the platform agent-preset registry is not mounted, so the runtime composition cannot be read' })
      continue
    }
    if (delta === null) {
      rows.push({ base: base.name, destination, status: 'unknown', detail: deltaFailure })
      continue
    }
    let platform: string
    try {
      platform = await registry.read(base.name)
    } catch (error) {
      rows.push({ base: base.name, destination, status: 'unknown', detail: `the runtime composition for base "${base.name}" could not be read (${error instanceof Error ? error.message : String(error)})` })
      continue
    }
    let fresh: string
    try {
      fresh = composePresetComposition(platform, delta)
    } catch (error) {
      rows.push({ base: base.name, destination, status: 'unknown', detail: `a fresh generation refused to compose (${error instanceof Error ? error.message : String(error)})` })
      continue
    }
    let onDisk: string
    try {
      onDisk = readFileSync(compositionPath, 'utf8')
    } catch (error) {
      rows.push({ base: base.name, destination, status: 'unknown', detail: `${compositionPath} could not be read (${error instanceof Error ? error.message : String(error)})` })
      continue
    }
    rows.push({ base: base.name, destination, status: fresh === onDisk ? 'fresh' : 'differs' })
  }
  return rows
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
  // G3-② (B2): the variant half of the report. Computed before the action
  // ladder so a stale snapshot contributes its own regeneration step; the
  // registry probe is the same optional-service read the preset installer does.
  const presetRegistry = ctx.get('agentPresets') as { read(id: string): Promise<string> } | undefined
  const presetFreshness = await probePresetFreshness(home, presetRegistry)

  const full = bundles.some(name => tailOf(name) === 'dsh-evolution-all')
  const host = bundles.some(name => tailOf(name) === 'dsh-evolution-host')
  const preset = bundles.some(name => tailOf(name) === 'dsh-evolution-preset')
  // V25-07/V26-02 (v25/v26): the layered side is detected by its DELIVERED
  // ARTIFACT (`agent.cordis.yml`, the file `/evolution preset install` and the
  // layered installer both write) rather than bare directory existence — an
  // empty or stale leftover directory must not report a layered install or
  // flag a healthy deployment. ONE detection feeds installForm AND every
  // layered conflict row.
  // S1-F1: the artifact is enumerated across EVERY installed family base —
  // the old single-directory probe (`{home}/.agent-presets/evolution`) was
  // blind to `--base ptc|cordis` layered installs and misdirected them into
  // the `all`-on-top advice below.
  const presetDir = join(home, '.agent-presets')
  const layeredIds = installedLayeredPresetIds(presetDir)
  const presetDirInstalled = layeredIds.length > 0
  const layeredArtifactLabel = presetDirInstalled ? layeredIds.join(', ') : 'evolution'
  const layered = host && presetDirInstalled

  if (full && host) conflicts.push('evolution-all and evolution-host are installed together — the infra rows double-mount and startup fails loud. Keep ONE: remove the other bundle.')
  if (full && preset) conflicts.push('evolution-all and evolution-preset are installed together — the infra rows double-mount. Keep ONE.')
  if (host && preset) conflicts.push('evolution-host and evolution-preset are installed together — the infra rows double-mount. Keep ONE.')
  // V27 G6.4: the conflict is the DELIVERED preset artifact, not the
  // host+preset `layered` form — `all` mounts the same four model rows at
  // profile root, so `all` + a preset directory double-mounts them even when
  // the host bundle is absent (the old `full && layered` condition required
  // host and stayed silent for exactly that combination).
  if (full && presetDirInstalled) conflicts.push(`evolution-all and the layered Evolution preset (${layeredArtifactLabel}) are both present — the model rows double-mount. Keep ONE (use layered without all, or drop the preset).`)
  // V24-11 (v24): the preset BUNDLE mounts the same four model rows as `all`
  // (tool-memory / tool-skill-manage / tool-session-query / skill-catalog),
  // so bundle × layered preset dir is the same double-mount as all × layered
  // — but `layered` requires `host`, so this combination used to pass the
  // matrix silently (installForm even reports the healthy 'preset') and a
  // user following the M4 steps on top of the one-click bundle got no
  // conflict at all.
  if (preset && presetDirInstalled) conflicts.push(`evolution-preset and the layered Evolution preset (${layeredArtifactLabel}) are both present — the model rows double-mount (the preset bundle carries the same model rows as all). Keep ONE (drop the preset bundle, or remove the layered preset).`)

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

  const installForm: DoctorReport['installForm'] = full ? 'full' : preset ? 'preset' : layered ? 'layered' : host ? 'host' : presetDirInstalled ? 'preset-only' : 'none'
  // 0.3.77 (C axis): the install form in PRODUCT terms. The distinction decides
  // whether a platform original preset session is a family session at all — the
  // cross-session rows carry `sessionScoped: true` and answer it per session.
  const deploymentForm: DoctorReport['deploymentForm'] = installForm === 'layered'
    ? 'variant'
    : installForm === 'full' || installForm === 'preset' ? 'attach' : installForm === 'host' ? 'host-only' : installForm === 'preset-only' ? 'preset-only' : 'none'

  // OPT-22 (2026-09): only real double-mount rows drive the action ladder's
  // "keep exactly one" advice. The enumeration/manifest DEGRADED detail also
  // lives in `conflicts` (report + --json compatibility) — but that detail
  // fires on an unreadable profiles dir or a torn manifest, where "uninstall
  // bundles" is the WRONG remedy (there may be no bundle conflict at all).
  // The word `DEGRADED` is the marker both degraded rows carry by contract.
  const mountConflicts = conflicts.filter(row => !row.includes('DEGRADED'))
  // S2.1 (v37 P2-19): a DEGRADED read leaves `bundles` undecidable, and the
  // ladder derived `none` from it — advising a deployment that already mounts
  // `all` to add it again (the double mount INST-01 exists to prevent).
  const undecidable = mountConflicts.length !== conflicts.length

  // S0-4 (v43 G-1 / J-1): the scoped half of the report. `reviewMounted` is the
  // bundle-derived presence of both scoped rows (every bundle that carries one
  // carries the other), and an undecidable bundle read must not render as "none
  // mounted" — the same fail-closed direction INST-01 / S2.1 set for bundles.
  const scopedProbe: ScopedProbeCheck = {
    rows: undecidable ? null : reviewMounted ? ['evolution-review', 'skill-usage'] : [],
    ...scopedProbeReport(),
  }

  const actions: string[] = []
  if (mountConflicts.length > 0) actions.push('Resolve the conflict first: keep exactly one of evolution-all / evolution-host / evolution-preset / layered.')
  else if (undecidable) actions.push('The install form is UNDECIDABLE (see the DEGRADED row above): an unreadable profiles directory or profile manifest hides whatever is installed, so this report must not add or remove a bundle. Fix the reported read failure, then re-run /evolution doctor.')
  else if (installForm === 'none') actions.push('Install the default full bundle: dsh plugin --profile web add @lmzhen/dsh-evolution-all')
  else if (installForm === 'preset-only') actions.push(`The Evolution preset is delivered but no profile mounts an evolution bundle — re-add @lmzhen/dsh-evolution-host for the layered layout (do NOT add all on top of the preset: that double-mounts the model rows), or remove .agent-presets/${layeredArtifactLabel} if the layered layout is no longer wanted.`)
  else if (installForm === 'layered') actions.push('Variant form (session opt-in): model tools follow the Evolution preset, and a session on a platform original preset carries no family rows; add @lmzhen/dsh-evolution-all instead if every session should have them.')
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
  const memoryIssues = memoryInterpolationIssues(home)
  const budgetIssues = memoryBudgetIssues(ctx)
  const queryIssues = await sessionQueryIssues(ctx)
  if (queryIssues.length > 0) actions.push('Session search is degraded: isolate the session named above (or wait for the platform fix described in the family maintenance notes) before retrying the same query')
  if (budgetIssues.length > 0) actions.push('Align the memory budget: leave memory-files memoryCharLimit/userCharLimit UNSET so the store follows evolution-policy, or set both surfaces to the same value (the review plans against the policy value while the store enforces its own)')
  if (memoryIssues.length > 0) actions.push('Rewrite the memory entries listed above (or run a build with the render-time neutralization) — they broke prompt assembly on older builds.')
  // S0-4 (v43 G-1 / J-1): the one state a user cannot see for themselves. The gate
  // answers per session BY DESIGN, so an all-false process looks exactly like a
  // deployment where every session is an original-preset session; only the row
  // set plus the witness separates them, and each shape needs a different move.
  if (scopedProbe.rows !== null && scopedProbe.rows.length > 0 && scopedProbe.verdict === 'never-hit') {
    actions.push('The session-scoped rows are mounted but the family-tool probe has never matched in this process — review injection and skill-usage telemetry skipped every session observed. HOST-ONLY install: the model rows (tool-memory / tool-skill-manage) sit in evolution-host devDependencies, so no session carries them; install a bundle that mounts them (see INSTALL.md). VARIANT install: only a session on the Evolution preset matches, so open one — a session on a platform original preset is the intended skip, not a fault. Either way, check that no profile overlay disables those two rows.')
  }
  if ((executingCount ?? 0) > 0) actions.push(`${executingCount} staged write(s) are EXECUTING (an approve crashed mid-run — or one is still in flight). Inspect with /evolution pending: if you started the approve, verify the landed write and do not reject it; only reject after verifying no write is intended. For a verified orphan (this build: S2-P2-22), /evolution release <id> returns it to the pending window instead.`)

  // G3-② (B2): only `differs` is actionable — the file is stale, not broken,
  // and regenerating it is the user's call. `absent` is a base the user never
  // installed, and `unknown` is a comparison that could not run at all, so
  // neither may be dressed up as advice to re-run the installer.
  for (const row of presetFreshness) {
    if (row.status !== 'differs') continue
    actions.push(`Preset variant ${row.destination} DIFFERS from a fresh generation — it is an install-time snapshot; re-run the installer (/evolution preset install) to regenerate`)
  }

  return {
    installForm, deploymentForm, bundles, conflicts, envIssues: env, memoryIssues, budgetIssues, queryIssues, services,
    pendingCount, executingCount, presetFreshness, scopedProbe, actions,
  }
}

/**
 * S2-12③ (FLOW5-4): the memory budget is configured in TWO places —
 * `memory-files`' `memoryCharLimit`/`userCharLimit` (what the STORE enforces)
 * and `evolution-policy`'s `memoryChars`/`userChars` (what the review PLANS
 * against; `memory-files` follows the policy only for an UNSET limit). A
 * disagreement therefore means an explicit contradiction, or a `memory-files`
 * row mounted before the policy existed — either way the reviewer budgets ops
 * the store will refuse. Read-only, like every other doctor row.
 *
 * @param ctx - the runtime service view (`get(name)`).
 * @returns one message per disagreeing surface; empty when not comparable.
 */
/**
 * S4/P-1+P-2 (platform report P-1/P-2, family mitigation) — the session-query
 * index can fail AS A WHOLE: a concurrent writer leaves the persistence
 * observation unstable ('did not stabilize after one retry') and ONE
 * header-conflicting session aborts the same try block, which the tool surface
 * folds into 'storage is unavailable'. Doctor cannot read the index's row count
 * or the last stabilization result (the platform exposes no such API — recorded
 * in the platform report), but it CAN exercise the corpus listing and report the
 * verbatim failure with the actionable half: isolate the offending session.
 *
 * @param ctx - the runtime service view (`get(name)`).
 * @returns one or two messages; empty when the service is absent or healthy.
 */
async function sessionQueryIssues(ctx: { get(name: string): unknown }): Promise<string[]> {
  const service = ctx.get('sessionQuery') as { listSessions?: (signal?: AbortSignal) => Promise<unknown> } | undefined
  if (service?.listSessions === undefined) return []
  try {
    const sessions = await service.listSessions()
    return Array.isArray(sessions)
      ? []
      : ['session-query answered a listing with a non-list value — the service is mounted but not honouring its read contract']
  } catch (error) {
    return [
      `session-query listing failed: ${error instanceof Error ? error.message : String(error)}`,
      'if that mentions an unstable observation or a conflicting session header, isolate the offending session — move it OUT of the corpus with a manifest (never delete it) and re-run; the platform already retries the observation once',
    ]
  }
}

function memoryBudgetIssues(ctx: { get(name: string): unknown }): string[] {
  const budget = ctx.get('evolutionMemoryBudget') as {
    memoryCharLimit?: number
    userCharLimit?: number
    memorySource?: string
    userSource?: string
  } | undefined
  const policy = (ctx.get('evolutionPolicy') as { get?: () => { memoryChars?: number; userChars?: number } } | undefined)?.get?.()
  if (budget === undefined || policy === undefined) return []
  const issues: string[] = []
  if (budget.memoryCharLimit !== undefined && policy.memoryChars !== undefined && budget.memoryCharLimit !== policy.memoryChars) {
    issues.push(`store enforces memoryCharLimit=${budget.memoryCharLimit} (source: ${budget.memorySource ?? 'unknown'}) while evolution-policy declares memoryChars=${policy.memoryChars} — the review plans against the policy value and the store refuses what exceeds its own`)
  }
  if (budget.userCharLimit !== undefined && policy.userChars !== undefined && budget.userCharLimit !== policy.userChars) {
    issues.push(`store enforces userCharLimit=${budget.userCharLimit} (source: ${budget.userSource ?? 'unknown'}) while evolution-policy declares userChars=${policy.userChars} — same divergence as the memory limit`)
  }
  return issues
}

/** S0-4 (v43 G-1 / J-1): the scoped-row reconciliation line. The verdict is the
 * runtime witness, the row set is what this home installs, and the two forms are
 * spelled out because they read identically in the numbers (`never-hit`) while
 * needing opposite responses: under the host-only form nothing can ever match,
 * under the variant form the match arrives with the first Evolution-preset
 * session.
 * @param check - the report's scoped-row check.
 * @returns one line, or the earlier diagnostic when either half is unknown. */
function scopedProbeLine(check: ScopedProbeCheck): string {
  if (check.rows === null) {
    return `scoped rows: (undecidable), probe=${check.verdict} — a DEGRADED bundle read hides which bundles are installed, so the scoped rows cannot be reconciled with the probe`
  }
  if (check.rows.length === 0) {
    return `scoped rows: (none mounted), probe=${check.verdict} — no installed bundle carries the session-scoped rows (evolution-review / skill-usage), so the gate is inactive here`
  }
  const rows = check.rows.map(row => `${row}=on`).join('/')
  const detail = check.verdict === 'hit'
    ? `${check.hits} scoped evaluation(s) carried the family tools`
    : check.verdict === 'never-hit'
      ? `${check.misses} scoped evaluation(s) resolved false — review injection and skill-usage telemetry are inert for every session observed; HOST-ONLY installs reach this because tool-memory / tool-skill-manage are not dependencies of evolution-host, VARIANT installs only match once a session runs the Evolution preset`
      : 'the gate has not evaluated a session in this process yet — no session event has reached it since startup'
  return `scoped rows: ${rows}, probe=${check.verdict} (${detail})`
}

export function renderDoctorText(report: DoctorReport): string {
  const lines = [
    `Evolution doctor — install form: ${report.installForm} (deployment: ${report.deploymentForm})`,
    `bundles (all profiles): ${report.bundles.length > 0 ? report.bundles.join(', ') : '(none)'}`,
    // v29 DOC-01: `review` is INFERRED from installed bundles across all
    // profiles (no runtime probe exists) — the render now says so, per the
    // docblock's promise, so a multi-profile machine cannot pass disk evidence
    // off as a mounted service.
    `services: review=${report.services.review} (inferred from bundles, all profiles) curator=${report.services.curator} approval=${report.services.approval} skillUsage=${report.services.skillUsage} io=${report.services.io}`,
    // S0-4 (v43 G-1 / J-1): appended beside the service line it qualifies; the
    // existing lines keep their order and wording.
    scopedProbeLine(report.scopedProbe),
    `pending: ${report.pendingCount === null ? 'unknown' : report.pendingCount}`,
    `executing: ${report.executingCount === null ? 'unknown' : report.executingCount}`,
  ]
  // G3-② (B2): one line per variant that EXISTS. `absent` rows are omitted —
  // every base this deployment does not install would otherwise claim a line
  // about a variant nobody chose; the report data keeps them for --json.
  for (const row of report.presetFreshness) {
    if (row.status === 'absent') continue
    const verdict = row.status === 'fresh'
      ? 'fresh — a fresh generation matches this file byte-for-byte'
      : row.status === 'differs'
        ? 'DIFFERS from a fresh generation — it is an install-time snapshot; re-run the installer (/evolution preset install) to regenerate'
        : `unknown — a fresh generation could not be recomputed (${row.detail ?? 'reason not recorded'})`
    lines.push(`preset:   ${row.destination}  ${verdict}`)
  }
  if (report.conflicts.length > 0) lines.push('conflicts:', ...report.conflicts.map(line => `  ! ${line}`))
  if (report.envIssues.length > 0) lines.push('env:', ...report.envIssues.map(line => `  ! ${line}`))
  if (report.memoryIssues.length > 0) lines.push('memory:', ...report.memoryIssues.map(line => `  ! ${line}`))
  if (report.budgetIssues.length > 0) lines.push('memory budget:', ...report.budgetIssues.map(line => `  ! ${line}`))
  if (report.queryIssues.length > 0) lines.push('session search:', ...report.queryIssues.map(line => `  ! ${line}`))
  if (report.actions.length > 0) lines.push('next steps:', ...report.actions.map(line => `  → ${line}`))
  return lines.join('\n')
}
