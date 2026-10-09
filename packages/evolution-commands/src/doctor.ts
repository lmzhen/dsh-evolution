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
import { composePresetEntry, evolutionRoot, isDeprecatedParamId, PARAM_EXPOSURE, paramSettingsId, presetRowBlock, presetRowBody, presetRowId, resolveParamId, scopedProbeReport, type EvolutionIoLike, type ScopedProbeReport, type SettingsProviderLike } from '@deepseek-ai/dsh-evolution-core'
import { readLegacyDocumentState } from './migration.ts'
import { readPlatformView } from './platform-view.ts'
import type { PlatformPlugin, PlatformPreset, PlatformView } from './platform-view.ts'
import { FAMILY_PRESET_ID_STEM, resolvePresetBasePatch, type PresetProfileTarget } from './preset-source.ts'

/** D-6 (v18): exact-segment tail match (the loose substring form matched a
 * hypothetical `dsh-evolution-allowlist`). */
const tailOf = (name: string): string => name.slice(name.lastIndexOf('/') + 1)
/** P2-20 (audit): the TS-side copy of the install-target tails. The script
 * side (install-layered.mjs, verify-profile-bundles.mjs) imports the list
 * from packages/scripts/lib-family-packages.mjs; guard-scripts.spec.ts pins
 * the two sides to each other. */
export const EVOLUTION_BUNDLE_TAILS = new Set(['dsh-evolution-all', 'dsh-evolution-host', 'dsh-evolution-preset'])

/** G3-② (B2): one delivered preset variant compared against a fresh generation.
 * "absent" is the user simply not using that base (never an action); "unknown"
 * is a comparison that could not run, kept distinct from a verified "fresh". */
export interface PresetFreshnessRow {
  /** Profile whose patch layer carries (or lacks) the row. */
  profile: string
  /** Agent-preset base name — the `--base` value the row was composed for. */
  base: string
  /** The profile patch compared: `<home>/profiles/<profile>/cordis.patch.yml`. */
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

/**
 * G5: which of the three family bundle forms a bundle-name list carries.
 * @param bundles - package names.
 * @returns one flag per form.
 */
function familyForms(bundles: readonly string[]): { full: boolean; host: boolean; preset: boolean } {
  return {
    full: bundles.some(name => tailOf(name) === 'dsh-evolution-all'),
    host: bundles.some(name => tailOf(name) === 'dsh-evolution-host'),
    preset: bundles.some(name => tailOf(name) === 'dsh-evolution-preset'),
  }
}

/**
 * G5: the live Loader entry carrying one family row.
 * @param plugins - the platform's entry list.
 * @param rowId - the row id the family knows.
 * @returns the entry, or undefined when this runtime carries no such row.
 */
function familyRow(plugins: readonly PlatformPlugin[], rowId: string): PlatformPlugin | undefined {
  return plugins.find(entry => entry.entryId === rowId || entry.entryId.endsWith(':' + rowId) || entry.moduleName === rowId)
}

/**
 * G5: the platform's own agent-preset verdicts.
 *
 * Only `broken` survives from the two candidates the design named. The other one — a row two
 * presets both declare — was measured on a real deployment and dropped: every platform base
 * composes the SAME base rows, so `persona` / `agent-instructions` / … are declared by every
 * preset in a perfectly healthy install, which buries the one case worth reporting (the family's
 * own bundle-vs-preset double mount, which the conflict matrix below already owns).
 * @param presets - the inventory's preset list, or undefined without that surface.
 * @returns one line per finding.
 */
function presetIssues(presets: readonly PlatformPreset[] | undefined): string[] {
  if (presets === undefined) return []
  const issues: string[] = []
  for (const preset of presets) {
    if (preset.broken !== undefined) issues.push(`agent preset \`${preset.id}\` is BROKEN (${preset.broken}) — the platform could not compose it`)
  }
  return issues
}

/**
 * S4.3: the parameter-surface divergences a RUNNING deployment can show and the
 * build-time guards cannot. Three classes, each with its own move:
 *  - a user override (the effective value is no longer the deployment's),
 *  - a deprecated alias still written in a user section (writes refuse it),
 *  - a declared user-writable parameter whose owner publishes no user layer in
 *    this composition (the registry promises a face this deployment never mounts).
 * G5: the two layers and the live rows come from the platform (`configEditor.configuration()`,
 * `pluginManager.listPlugins()`); the registry side (which spellings are deprecated, which rows
 * declare an E3 parameter) stays the family's own table. A surface that is not mounted is
 * reported AS SUCH: silence would read as "no divergences", the one claim this section checks.
 * @param platform - the platform view.
 * @returns one readable line per divergence, empty when there is nothing to compare.
 */
function paramDivergences(platform: PlatformView): string[] {
  if (platform.configuration === undefined) {
    return ['the platform configuration surface (configEditor.configuration) is not mounted here — parameter divergences were NOT checked']
  }
  const issues: string[] = []
  for (const row of platform.configuration) {
    const override = asMapping(row.override)
    if (override === undefined) continue
    const keys = Object.keys(override)
    if (keys.length === 0) continue
    // The platform hands over the ENTRY, not an id: name it the way the plugin page does.
    const entryId = row.entry.options?.id ?? row.entry.options?.name ?? '(unnamed entry)'
    const shown = keys.slice(0, 5).map(key => `${key}=${JSON.stringify(override[key])}`)
    const more = keys.length > shown.length ? ` and ${keys.length - shown.length} more` : ''
    issues.push(`user override: ${entryId} sets ${keys.length} parameter(s) — ${shown.join(', ')}${more}`)
    for (const key of keys) {
      if (!isDeprecatedParamId(key)) continue
      issues.push(`deprecated name: ${entryId} still writes "${key}" — write "${resolveParamId(key)}" instead (writes refuse the alias; removal was planned for 0.7.0 and is deferred — the alias still ships)`)
    }
  }
  // The reachability half needs the platform's live rows: a declared E3 parameter whose owning
  // row this runtime does not carry is a promise the deployment never mounts.
  if (platform.plugins === undefined) {
    issues.push('the platform plugin-row surface (pluginManager.listPlugins) is not mounted here — declared-but-unreachable parameters were NOT checked')
    return issues
  }
  const live = liveRowTails(platform.plugins)
  const unreachable = PARAM_EXPOSURE.filter(entry => entry.tier === 'E3')
    .filter((entry) => {
      const namespace = paramSettingsId(entry.owner)
      return namespace === undefined || !live.has(namespace)
    })
    .map(entry => entry.id)
  if (unreachable.length > 0) {
    const shown = unreachable.slice(0, 6).join(', ')
    const more = unreachable.length > 6 ? ` (+${unreachable.length - 6} more)` : ''
    issues.push(`declared user-writable but unreachable here: ${shown}${more} — the owning row is not mounted in this runtime`)
  }
  return issues
}

/**
 * The row id a Loader entry id ends in (`include:memory-files` → `memory-files`).
 * @param plugins - the platform's entry list.
 * @returns the tails, plus every module name the platform reported.
 */
function liveRowTails(plugins: readonly PlatformPlugin[]): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const entry of plugins) {
    ids.add(entry.entryId)
    ids.add(entry.entryId.slice(entry.entryId.lastIndexOf(':') + 1))
    if (entry.moduleName !== undefined) ids.add(entry.moduleName)
  }
  return ids
}

/**
 * Read a value as a plain mapping (an override layer with no keys is not a divergence).
 * @param value - the parsed layer.
 * @returns the mapping, or undefined for anything else.
 */
function asMapping(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** G3 (stage 8): what the family's LEGACY settings document still holds.

 * Read-only: the boot migration and `/evolution migrate` write; doctor only answers whether
 * anything is left. `none` (a document with no family section) and `absent` (no document) are
 * different findings — the first means the values were never the family's, the second that the
 * platform's import already took the file away.
 */
export interface LegacyMigrationRow {
  /** `migrated` = every family value sits on its row; `pending` = some do not; `none` = the
   * document carries no family section; `absent` = no legacy document under this home;
   * `unavailable` = no settings seat or no IO seam to read through. */
  readonly state: 'migrated' | 'pending' | 'none' | 'absent' | 'unavailable'
  /** The document the verdict came from, when one was read. */
  readonly source: string | undefined
  /** Keys still waiting for their row, as `rowId.key`. */
  readonly pending: readonly string[]
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
  /** S4.3: parameter-surface divergences — user overrides, deprecated aliases
   * still written, and E3 rows whose owner publishes no user layer here. Empty
   * when the settings service is absent (nothing to compare). */
  paramIssues: string[]
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
  /** G3 (stage 8): the legacy settings document's remaining work. */
  legacy: LegacyMigrationRow
  /** G5: the family bundles the RUNNING profile selects, per the platform's `listBundles()`;
   * null when that surface is not mounted — `bundles` then carries the cross-profile aggregate. */
  runtimeBundles: string[] | null
  /** G5: where the install form came from. `aggregate` = the cross-profile scan (the surface
   * was absent), so the form describes every profile on the machine, not this runtime. */
  formSource: 'platform' | 'aggregate'
  /** G5: the platform's own preset verdicts (see {@link presetIssues}). */
  presetIssues: string[]
  /** G5: family bundles this profile INSTALLS without selecting them (`enabled: false`) — the
   * plugin page lists those too, so doctor names them instead of leaving a visible mismatch. */
  dormantBundles: string[]
  /** G5: where the review row's presence came from: the live entry, or the aggregate inference. */
  serviceSource: 'platform' | 'bundles'
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
 * Platform anchor: `packages/boot/app-boot/src/profile.ts` — a family preset is a ROW in the
 * profile's own patch layer there (`PROFILE_PATCH_FILENAME`), never a preset directory. */
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
function readAgentPresetBases(path: string): Array<BaseRow> | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { bases?: unknown }
    if (!Array.isArray(parsed.bases)) return null
    const rows: BaseRow[] = []
    for (const raw of parsed.bases) {
      const entry = raw as { name?: unknown; id?: unknown; display?: unknown; requires?: unknown; unsupported?: unknown }
      if (typeof entry.name !== 'string' || typeof entry.id !== 'string') return null
      const display = entry.display as { name?: unknown; description?: unknown; order?: unknown } | null | undefined
      if (display === null || typeof display !== 'object'
        || typeof display.name !== 'string' || typeof display.description !== 'string'
        || typeof display.order !== 'number' || !Number.isInteger(display.order)) return null
      const requires = entry.requires as { service?: unknown } | null | undefined
      rows.push({
        name: entry.name,
        id: entry.id,
        display: { name: display.name, description: display.description, order: display.order },
        ...(requires !== null && typeof requires === 'object' && typeof requires.service === 'string'
          ? { requires: { service: requires.service } }
          : {}),
        ...(typeof entry.unsupported === 'string' ? { unsupported: entry.unsupported } : {}),
      })
    }
    return rows.length > 0 ? rows : null
  } catch {
    // A missing or torn table is a broken install, not "no bases": the caller
    // reports unknown rather than comparing against an empty expectation.
    return null
  }
}

/** One base row of the family table, as the doctor reads it. */
interface BaseRow {
  name: string
  id: string
  display: { name: string; description: string; order: number }
  requires?: { service: string }
  unsupported?: string
}

/** The profile patch file name (`packages/boot/app-boot/src/profile.ts`,
 * `PROFILE_PATCH_FILENAME`). */
const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

/** Every profile directory under one DSH_HOME, by name.
 * @param home - resolved DSH_HOME.
 * @returns `{ profile, dir }` per directory under `profiles/` that carries a manifest.
 */
function profileDirectories(home: string): Array<{ profile: string; dir: string }> {
  const out: Array<{ profile: string; dir: string }> = []
  const root = join(home, 'profiles')
  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    // No profiles yet: nothing is installed, which is the caller's `none` form.
    return out
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    // `profiles/node_modules` is created by app-boot on every launch and never
    // holds a manifest (S2.1): it is not a profile.
    if (entry.name === 'node_modules') continue
    const dir = join(root, entry.name)
    if (!existsSync(join(dir, 'package.json'))) continue
    out.push({ profile: entry.name, dir })
  }
  return out
}

/** The bundle rows one profile manifest mounts (scope-agnostic, as written).
 * @param profileDir - the profile directory.
 * @returns the bundle names; empty when the manifest is missing or torn.
 */
function profileBundles(profileDir: string): string[] {
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: unknown } } }
    const bundles = manifest.dsh?.profile?.bundles
    return Array.isArray(bundles) ? bundles.filter((name): name is string => typeof name === 'string') : []
  } catch {
    return []
  }
}

/** The profile patch text, or `''` when the profile has none.
 * @param profileDir - the profile directory.
 * @returns the patch text.
 */
function profilePatchText(profileDir: string): string {
  try {
    return readFileSync(join(profileDir, PROFILE_PATCH_FILENAME), 'utf8')
  } catch {
    return ''
  }
}

/** Whether a base's `requires.service` precondition is met by one profile's bundles — the same
 * judgement the installer applies (`baseUnavailableReason`), read from the same rows.
 * @param base - the table row.
 * @param bundles - the profile's bundle names.
 * @returns true when the base can be installed here.
 */
function baseInstallable(base: BaseRow, bundles: string[]): boolean {
  if (typeof base.unsupported === 'string') return false
  const service = base.requires?.service
  if (typeof service !== 'string' || service === '') return true
  return bundles.some(name => name.trim().endsWith('dsh-web-app'))
}

/**
 * S1-F1: ids of the family's INSTALLED preset rows — every declared preset row in a profile patch
 * that can actually carry the family model rows.
 *
 * The artifact is a declared preset ROW in a profile's own patch layer, so this probe reads that
 * file (`PROFILE_PATCH_FILENAME`) in every profile of the home. A probe narrowed to one base id
 * leaves a `--base ptc|cordis` install invisible: installForm then degrades to `none`/`host` and
 * the action ladder recommends installing `evolution-all` on top — the exact double-mount the
 * doctor exists to prevent.
 *
 * A row counts only when the base table names its id as a SUPPORTED family base (the `unsupported`
 * minimal base carries no model rows and cannot double-mount anything). When the table itself
 * cannot be read, any `preset-<family stem>*` row counts — the flag-rather-than-stay-silent
 * posture of {@link probePresetFreshness}.
 * @param home - resolved DSH_HOME.
 * @returns installed family base ids, in profile-then-table order.
 */
function installedLayeredPresetIds(home: string): string[] {
  const basesPath = resolveAgentPresetAsset('bases.json')
  const bases = basesPath === null ? null : readAgentPresetBases(basesPath)
  const ids = new Set<string>()
  for (const { dir } of profileDirectories(home)) {
    const text = profilePatchText(dir)
    if (text === '') continue
    if (bases === null) {
      // Table unreadable, so base ids cannot arbitrate: match the family's own
      // row-id stem, which every shipped base shares (`evolution-agent/bases.json`).
      for (const match of text.matchAll(/^\s*- id:\s*(preset-[a-z0-9-]+)\s*$/gm)) {
        if (match[1]?.startsWith(`preset-${FAMILY_PRESET_ID_STEM}`)) ids.add(match[1].slice('preset-'.length))
      }
      continue
    }
    for (const base of bases) {
      if (typeof base.unsupported === 'string') continue
      if (presetRowBlock(text, presetRowId(base.id)) !== null) ids.add(base.id)
    }
  }
  return [...ids]
}

/**
 * G3-② (B2): recompute what a fresh generation would write for every
 * installed variant and compare it byte-for-byte with the file on disk.
 *
 * The recomputation goes through composePresetEntry — the SAME composer
 * /evolution preset install and install-layered.mjs apply (base patch rows +
 * collision guard + row-overrides.json), so doctor cannot disagree with the
 * installer about what "fresh" means. Read-only by contract: the snapshot is
 * never rewritten.
 * @param home - resolved DSH_HOME.
 * @returns one row per profile × installable base of the family bases.json.
 */
function probePresetFreshness(home: string): PresetFreshnessRow[] {
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
  const profiles = profileDirectories(home)
  if (bases === null) {
    // No table means no base can be NAMED, but an installed row is still
    // visible in the patch — report it as unknown instead of silently clean.
    const tablePath = basesPath ?? `${AGENT_PRESET_PACKAGE}/bases.json`
    return profiles.flatMap(({ profile, dir }) => {
      const patchPath = join(dir, PROFILE_PATCH_FILENAME)
      const text = profilePatchText(dir)
      return [...text.matchAll(/^\s*- id:\s*(preset-[a-z0-9-]+)\s*$/gm)]
        .map(match => match[1] as string)
        .map(id => ({
          profile,
          base: id.slice('preset-'.length),
          destination: patchPath,
          status: 'unknown' as const,
          detail: `the family base table could not be read (${tablePath}) — a fresh generation cannot be recomputed`,
        }))
    })
  }
  const rows: PresetFreshnessRow[] = []
  for (const { profile, dir } of profiles) {
    const patchPath = join(dir, PROFILE_PATCH_FILENAME)
    const text = profilePatchText(dir)
    const bundles = profileBundles(dir)
    for (const base of bases) {
      // A base this deployment cannot install has no fresh generation to compare
      // against, so it is SKIPPED rather than reported stale.
      if (!baseInstallable(base, bundles)) continue
      // Not installed is not an error: the user may simply not use this base.
      const block = presetRowBlock(text, presetRowId(base.id))
      if (block === null) {
        rows.push({ profile, base: base.name, destination: patchPath, status: 'absent' })
        continue
      }
      if (delta === null) {
        rows.push({ profile, base: base.name, destination: patchPath, status: 'unknown', detail: deltaFailure })
        continue
      }
      // The base patch is read only here: an absent row above needs no platform
      // file, so a home with no family preset never fails this probe. The
      // module-graph candidate inside the resolver reaches the running
      // installation, which is the same one every profile of this home mounts.
      const target: PresetProfileTarget = { profile, profileDir: dir, patchPath, bundles }
      let fresh: string
      try {
        fresh = composePresetEntry(readFileSync(resolvePresetBasePatch(base.name, target), 'utf8'), delta, {
          rowId: presetRowId(base.id),
          id: base.id,
          name: base.display.name,
          description: base.display.description,
          order: base.display.order,
        })
      } catch (error) {
        rows.push({ profile, base: base.name, destination: patchPath, status: 'unknown', detail: error instanceof Error ? error.message : String(error) })
        continue
      }
      // Compare ROW BODIES: the block in the patch is the enclosing item (column 0 for a row the
      // Web editor saved, `- insert:` for one the installer wrote), the recomputation is always an
      // `- insert:` entry — comparing them raw called every editor-saved row stale forever.
      rows.push({ profile, base: base.name, destination: patchPath, status: presetRowBody(fresh) === presetRowBody(block) ? 'fresh' : 'differs' })
    }
  }
  return rows
}

/**
 * Diagnose the deployment. `ctx` supplies service presence (a bare stub with
 * only `get` is enough); `home` defaults to the evolution root so tests can
 * point doctor at a temp DSH_HOME.
 */
/**
 * The legacy settings document's remaining work, for the doctor report.
 *
 * Every failure mode is a verdict, not an exception: a deployment without the settings seat
 * or the family IO seam reports `unavailable`, and an unreadable document is reported through
 * the same warn channel the boot migration uses.
 * @param ctx - the context (services), read structurally.
 * @param home - the profile home the legacy document sits in.
 * @returns the row the report renders.
 */
async function legacyMigrationRow(ctx: { get(name: string): unknown }, home: string): Promise<LegacyMigrationRow> {
  const settings = ctx.get('settings') as SettingsProviderLike | undefined
  const io = (ctx.get('evolutionIo') as { provider?(): EvolutionIoLike } | undefined)?.provider?.()
  if (settings?.describe === undefined || io === undefined) return { state: 'unavailable', source: undefined, pending: [] }
  try {
    const state = await readLegacyDocumentState({ home, io, settings })
    if (state === undefined) return { state: 'absent', source: undefined, pending: [] }
    if (state.sections === 0) return { state: 'none', source: state.source, pending: [] }
    return { state: state.pending.length > 0 ? 'pending' : 'migrated', source: state.source, pending: state.pending }
  } catch (error) {
    const logger = (ctx as { logger?: { warn(message: string, ...rest: unknown[]): void } }).logger
    logger?.warn('evolution-commands: the legacy settings document could not be read — %s', error instanceof Error ? error.message : String(error))
    return { state: 'unavailable', source: undefined, pending: [] }
  }
}

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
  // ladder so a stale snapshot contributes its own regeneration step. The
  // comparison reads the profile patches and the platform base patches — the
  // same two files the installer writes and reads.
  const presetFreshness = probePresetFreshness(home)

  // G5: the RUNNING profile's form comes from the platform's own bundle surface when it is
  // mounted. The cross-profile enumeration above stays for the N13 question ("which forms
  // exist on this machine") and is labelled as aggregation wherever it is rendered.
  const platform = await readPlatformView(ctx)
  // `enabled` is the platform's own "selected in this profile" flag: an INSTALLED dependency that
  // no `dsh.profile.bundles` entry selects is not mounted, so it is not part of the runtime form.
  const familyBundleRows = platform.bundles?.filter(row => tailOf(row.name).startsWith('dsh-evolution-'))
  const runtimeBundles = familyBundleRows === undefined ? undefined : familyBundleRows.filter(row => row.enabled).map(row => row.name)
  const dormantBundles = familyBundleRows?.filter(row => !row.enabled).map(row => row.name) ?? []
  const runtimeFlags = runtimeBundles === undefined ? undefined : familyForms(runtimeBundles)
  const aggregateFlags = familyForms(bundles)
  const forms = runtimeFlags ?? aggregateFlags
  const full = forms.full
  const host = forms.host
  const preset = forms.preset
  // V25-07/V26-02 (v25/v26): the layered side is detected by its DELIVERED
  // ARTIFACT — the declared preset ROW `/evolution preset install` and the
  // layered installer both write — rather than bare marker existence, so a
  // stale leftover cannot report a layered install or flag a healthy deployment.
  // ONE detection feeds installForm AND every layered conflict row.
  // S1-F1: the artifact is enumerated across EVERY installed family base — the
  // old single-id probe was blind to `--base ptc|cordis` installs and
  // misdirected them into the `all`-on-top advice below.
  const layeredIds = installedLayeredPresetIds(home)
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
  // PLAN S5.10 (2026-09-16, audit P2-28 closing half): the warn spells out the
  // MECHANISM that until now only INSTALL.md documented — the four model rows
  // AND the systemPrompt sections exist twice across the profile and preset
  // layers, and the preset loader does not fail on it: shadowing semantics
  // hand the session to the nearest layer, so the duplication is swallowed
  // silently instead of failing loud like the bundle×bundle infra rows above.
  if (full && presetDirInstalled) conflicts.push(`evolution-all and the layered Evolution preset (${layeredArtifactLabel}) are both present — the four model rows AND the systemPrompt sections double-instance across the profile and preset layers; the preset loader does not fail on it, shadowing semantics take the nearest layer, so an Evolution-preset session silently runs the preset's copies of everything. Keep ONE (use layered without all, or drop the preset).`)
  // V24-11 (v24): the preset BUNDLE mounts the same four model rows as `all`
  // (tool-memory / tool-skill-manage / tool-session-query / skill-catalog),
  // so bundle × layered preset dir is the same double-mount as all × layered
  // — but `layered` requires `host`, so this combination used to pass the
  // matrix silently (installForm even reports the healthy 'preset') and a
  // user following the M4 steps on top of the one-click bundle got no
  // conflict at all. Same explicit S5.10 mechanism wording as the all ×
  // layered row above.
  if (preset && presetDirInstalled) conflicts.push(`evolution-preset and the layered Evolution preset (${layeredArtifactLabel}) are both present — the preset bundle carries the same model rows as all, so the four model rows AND the systemPrompt sections double-instance and shadowing semantics take the nearest layer (the preset loader does not fail on it). Keep ONE (drop the preset bundle, or remove the layered preset).`)

  // P0-1 fix (v11): `evolutionReview` is NOT a provided service — review only
  // registers session-event hooks. Infer its presence from the install form
  // (any of the three bundles carries the review row) instead of a ghost key.
  // G5: with the platform's row surface mounted, "the review row is here" is a platform fact
  // (row present AND enabled), not an inference from which bundles are installed. Without that
  // surface (a trimmed base, or the headless plane) the inference stays, labelled in the report.
  const reviewRow = platform.plugins === undefined ? undefined : familyRow(platform.plugins, 'evolution-review')
  const reviewMounted = reviewRow?.enabled ?? (full || host || preset)
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
  const approvalList = approvalService?.list?.bind(approvalService)
  if (approvalList !== undefined) {
    try {
      // R-1 (same class as the session-query probe): a wedged approval service
      // must render as "unknown", not hang the command.
      const pendingProbe = await probeBounded(() => approvalList('pending'), 'approval pending listing')
      const rows = pendingProbe.ok ? pendingProbe.value : undefined
      pendingCount = Array.isArray(rows) ? rows.length : null
      // v23 (AP-2): 'executing' is the one state that can NOT resolve itself —
      // a claimed-but-crashed approve is only ever cleared by an operator
      // reject. Hiding it made doctor report "pending: 0" while a stuck
      // record sat in the queue (visible only via /evolution pending).
      const executingProbe = await probeBounded(() => approvalList('executing'), 'approval executing listing')
      const executing = executingProbe.ok ? executingProbe.value : undefined
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
  else if (installForm === 'preset-only') actions.push(`The Evolution preset row is installed but no profile mounts an evolution bundle — re-add @lmzhen/dsh-evolution-host for the layered layout (do NOT add all on top of the preset: that double-mounts the model rows), or drop the row (${layeredArtifactLabel}) from the profile patch if the layered layout is no longer wanted.`)
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
  const presetIssueRows = presetIssues(platform.presets)
  if (presetIssueRows.length > 0) actions.push('Resolve the agent-preset finding above: a broken preset composes no session, and a row two presets declare is resolved by layer order (keep the declaration in one preset).')
  const legacy = await legacyMigrationRow(ctx, home)
  if (legacy.state === 'pending') {
    actions.push(`The legacy settings document still holds ${legacy.pending.length} family value(s) — /evolution migrate moves them onto their rows (the document itself is left alone, so nothing is lost)`)
  }
  const memoryIssues = memoryInterpolationIssues(home)
  const budgetIssues = memoryBudgetIssues(ctx)
  const paramIssues = paramDivergences(platform)
  const queryIssues = await sessionQueryIssues(ctx)
  if (queryIssues.length > 0) actions.push('Session search is degraded: isolate the session named above (or wait for the platform fix described in the family maintenance notes) before retrying the same query')
  if (paramIssues.length > 0) actions.push('Review the parameter divergences above: /evolution params shows every row with its source, /evolution policy set writes a user value, and a declared-but-unreachable row needs its owning plugin row mounted in this profile.')
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
    actions.push(`Preset row for base "${row.base}" in ${row.destination} DIFFERS from a fresh generation — it is an install-time snapshot; re-run the installer (/evolution preset install) to regenerate`)
  }

  return {
    installForm, deploymentForm, bundles, conflicts, envIssues: env, memoryIssues, budgetIssues, paramIssues, queryIssues, services,
    pendingCount, executingCount, presetFreshness, scopedProbe, legacy,
    runtimeBundles: runtimeBundles ?? null,
    formSource: runtimeFlags === undefined ? 'aggregate' : 'platform',
    presetIssues: presetIssueRows,
    dormantBundles,
    serviceSource: reviewRow === undefined ? 'bundles' : 'platform',
    actions,
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
/** S4 review (source-first pass) R-1: how long a diagnostic probe may wait.
 * Doctor must ANSWER even when the thing it probes is blocked — the failure it
 * reports (a concurrent writer stalling the corpus) is exactly the one that
 * would otherwise hang the command forever. */
const PROBE_TIMEOUT_MS = 5_000

/**
 * Bound a diagnostic probe. A never-settling service is a FINDING, not a hang:
 * the probe reports it like any other failure.
 *
 * Takes a THUNK, not a promise (review R-2): a mounted-but-broken service can
 * throw synchronously, and `probeBounded(Promise.resolve(service.list()))` would
 * let that throw escape the probe — crashing the command instead of reporting.
 *
 * @param work - the probe's work, invoked inside the guard.
 * @param label - the surface being probed (named in the finding).
 * @returns the value, or a message describing the failure/timeout.
 */
async function probeBounded<T>(work: () => Promise<T>, label: string): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  let started: Promise<T>
  try {
    started = work()
  } catch (error) {
    return { ok: false, message: `${label} failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<{ ok: false; message: string }>((resolve) => {
    timer = setTimeout(() => {
      resolve({ ok: false, message: `${label} did not answer within ${PROBE_TIMEOUT_MS}ms — the corpus is blocked (a concurrent writer can stall the observation) or the service is wedged; isolate the most recently written session and re-run` })
    }, PROBE_TIMEOUT_MS)
  })
  const settled = started.then(
    (value): { ok: true; value: T } => ({ ok: true, value }),
    (error: unknown): { ok: false; message: string } => ({ ok: false, message: `${label} failed: ${error instanceof Error ? error.message : String(error)}` }),
  )
  const outcome = await Promise.race([settled, timeout])
  if (timer !== undefined) clearTimeout(timer)
  return outcome
}

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
  // Bind the receiver: the platform's service methods are prototype methods and a
  // detached reference loses `this` (the family's N13b rule, learned on the
  // platform Agent's send()/followup()).
  const list = service?.listSessions?.bind(service)
  if (list === undefined) return []
  // R-1: bounded — the listing path is precisely what a concurrent writer stalls,
  // so an unbounded await here would hang the command on the state it reports.
  const outcome = await probeBounded(() => list(), 'session-query listing')
  if (!outcome.ok) {
    return [
      outcome.message,
      'isolate the offending session — move it OUT of the corpus with a manifest (never delete it) and re-run; the platform already retries the observation once, so retrying first is not the answer',
    ]
  }
  return Array.isArray(outcome.value)
    ? []
    : ['session-query answered a listing with a non-list value — the service is mounted but not honouring its read contract']
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

/**
 * One line for the legacy settings document's state.
 * @param row - the report's legacy row.
 * @returns the rendered line.
 */
function legacyLine(row: LegacyMigrationRow): string {
  if (row.state === 'unavailable') return 'legacy settings: unknown — no settings seat or no family IO seam is mounted here'
  if (row.state === 'absent') return 'legacy settings: no settings.yaml / settings.yaml.imported under this home'
  if (row.state === 'none') return `legacy settings: ${row.source ?? '(unknown)'} carries no family section`
  if (row.state === 'migrated') return `legacy settings: every family value sits on its row (${row.source ?? '(unknown)'})`
  const shown = row.pending.slice(0, 6).join(', ')
  const more = row.pending.length > 6 ? ` (+${row.pending.length - 6} more)` : ''
  return `legacy settings: ${row.pending.length} family value(s) still on ${row.source ?? '(unknown)'}: ${shown}${more} — /evolution migrate moves them`
}

export function renderDoctorText(report: DoctorReport): string {
  // `null` marks a line this report does not carry (a fact that is not true here); the join drops it.
  const lines: (string | null)[] = [
    `Evolution doctor — install form: ${report.installForm} (deployment: ${report.deploymentForm}; from ${report.formSource === 'platform' ? "this runtime's bundle surface" : 'the cross-profile aggregate'})`,
    // G5: the RUNNING profile's own bundle list, from the platform. `unknown` is a verdict, not
    // an empty list: a trimmed base without `pluginManager` must not read as "no bundles".
    report.runtimeBundles === null
      ? 'runtime bundles: unknown — the platform bundle surface (pluginManager.listBundles) is not mounted here'
      : `runtime bundles (this profile): ${report.runtimeBundles.length > 0 ? report.runtimeBundles.join(', ') : '(none)'}`,
    report.dormantBundles.length === 0
      ? null
      : `installed but not selected: ${report.dormantBundles.join(', ')} — the Plugins page lists them; this runtime mounts neither`,
    `bundles (all profiles): ${report.bundles.length > 0 ? report.bundles.join(', ') : '(none)'}`,
    // v29 DOC-01: `review` is INFERRED from installed bundles across all
    // profiles (no runtime probe exists) — the render now says so, per the
    // docblock's promise, so a multi-profile machine cannot pass disk evidence
    // off as a mounted service.
    `services: review=${report.services.review} (${report.serviceSource === 'platform' ? 'the live row, this runtime' : 'inferred from bundles, all profiles'}) curator=${report.services.curator} approval=${report.services.approval} skillUsage=${report.services.skillUsage} io=${report.services.io}`,
    // S0-4 (v43 G-1 / J-1): appended beside the service line it qualifies; the
    // existing lines keep their order and wording.
    scopedProbeLine(report.scopedProbe),
    legacyLine(report.legacy),
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
    lines.push(`preset:   ${row.base} → ${row.destination}  ${verdict}`)
  }
  if (report.presetIssues.length > 0) lines.push('agent presets:', ...report.presetIssues.map(line => `  ! ${line}`))
  if (report.conflicts.length > 0) lines.push('conflicts:', ...report.conflicts.map(line => `  ! ${line}`))
  if (report.envIssues.length > 0) lines.push('env:', ...report.envIssues.map(line => `  ! ${line}`))
  if (report.memoryIssues.length > 0) lines.push('memory:', ...report.memoryIssues.map(line => `  ! ${line}`))
  if (report.budgetIssues.length > 0) lines.push('memory budget:', ...report.budgetIssues.map(line => `  ! ${line}`))
  if (report.paramIssues.length > 0) lines.push('parameters:', ...report.paramIssues.map(line => `  ! ${line}`))
  if (report.queryIssues.length > 0) lines.push('session search:', ...report.queryIssues.map(line => `  ! ${line}`))
  if (report.actions.length > 0) lines.push('next steps:', ...report.actions.map(line => `  → ${line}`))
  return lines.filter((line): line is string => line !== null).join('\n')
}
