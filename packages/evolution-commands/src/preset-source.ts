/**
 * Where a family preset ROW is written, and where the platform base rows it composes come from.
 *
 * 0.2.x replaced the preset directory with an ordinary composition row
 * (`packages/preset/agent-preset/src/index.ts`), so a family preset is a row in the profile's own
 * patch layer — the file the platform's Web editor also saves preset edits to — and the base rows
 * are the bundle patch layer that declares the platform's preset
 * (`packages/bundle/web-app/presets/<base>.patch.yml`).
 *
 * Platform anchors: `packages/boot/app-boot/src/profile-context.ts` (the launcher-owned
 * `profileContext` — `{ name, dir, patchPath, startedBundles }` — this module reads) and
 * `packages/boot/app-boot/src/profile.ts` (`PROFILE_PATCH_FILENAME`).
 * @module
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveBasePresetPatch } from '@deepseek-ai/dsh-evolution-core'

/** The launcher-owned profile facts a preset write needs. */
export interface PresetProfileTarget {
  /** Profile name, e.g. `web`. */
  readonly profile: string
  /** Absolute profile directory. */
  readonly profileDir: string
  /** Absolute path of the profile's `cordis.patch.yml` — where a new row goes. */
  readonly patchPath: string
  /** Bundle package names this process started with (`startedBundles`). */
  readonly bundles: readonly string[]
}

/** The patch file name inside a profile directory (`packages/boot/app-boot/src/profile.ts`,
 * `PROFILE_PATCH_FILENAME`). */
export const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

/** The runtime surface `profileContext` carries; only the fields this module reads. */
interface ProfileContextLike {
  readonly name: string
  readonly dir: string
  readonly patchPath: string
  readonly startedBundles: readonly string[]
}

/**
 * The profile patch this process writes into, or undefined outside a profile.
 *
 * `profileContext` is registered by the profile launcher only
 * (`packages/boot/app-boot/src/profile-context.ts`); a bare library mount — the family's own specs,
 * or a host started without a profile — has none, and then there is no file for a row to live in.
 * @param ctx - the plugin context (a `get(name)` view is enough).
 * @returns the target, or undefined when no profile is mounted.
 */
export function presetProfileTarget(ctx: { get(name: string): unknown }): PresetProfileTarget | undefined {
  const profile = ctx.get('profileContext') as ProfileContextLike | undefined
  if (profile === undefined || typeof profile.dir !== 'string' || profile.dir === '') return undefined
  return {
    profile: profile.name,
    profileDir: profile.dir,
    patchPath: typeof profile.patchPath === 'string' && profile.patchPath !== ''
      ? profile.patchPath
      // The launcher always publishes `patchPath`; a caller-supplied context without it still
      // resolves the same file the platform reads.
      : join(profile.dir, PROFILE_PATCH_FILENAME),
    bundles: Array.isArray(profile.startedBundles) ? profile.startedBundles : [],
  }
}

/** The family preset id stem: every shipped id starts with it (`evolution-agent/bases.json`),
 * which is what a profile carrying a family row is recognized by when the table itself cannot be
 * read. */
export const FAMILY_PRESET_ID_STEM = 'evolution'

/** One base-table row's ability fields — the part `evolution-agent/bases.json` declares and every
 * entry point reads. */
export interface BaseAbilityRow {
  /** Base name, as `--base` spells it. */
  readonly name: string
  /** The registration note that makes a base unsupported (it carries no family landing surface). */
  readonly unsupported?: string
  /** The runtime service the base's platform composition injects. */
  readonly requires?: { readonly service?: string }
}

/**
 * The ONE host-side answer to "can this base be used here?".
 *
 * Both host entry points ask it: `/evolution preset install` refuses a base through this function,
 * and `/evolution doctor` enumerates the installable bases through it, with the SAME probe — the
 * runtime's own answer (`ctx.get(<service>)`), which is exactly the reason a later mount would
 * refuse. A doctor that infers the answer from bundle names instead (it did until v46 S2.8) can
 * disagree with the write entry it tells the operator to run: a deployment that mounts the web-app
 * bundle while the service's own row is disabled installs nothing, yet reads as installable. The
 * source-checkout installer runs outside the host and cannot read the service store; it asks the
 * target profile's bundle rows instead and says so (`install-layered.mjs`'s
 * `baseUnavailableReason`).
 * @param entry - the table row.
 * @param servicePresent - whether a service name resolves in this deployment.
 * @returns the refusal text, or undefined when the base is usable here.
 */
export function baseRefusalReason(entry: BaseAbilityRow, servicePresent: (name: string) => boolean): string | undefined {
  if (typeof entry.unsupported === 'string' && entry.unsupported !== '') {
    return `Base "${entry.name}" is registered as UNSUPPORTED: ${entry.unsupported}`
  }
  const service = entry.requires?.service
  if (typeof service !== 'string' || service === '') return undefined
  return servicePresent(service)
    ? undefined
    : `Base "${entry.name}" requires the "${service}" service, which this deployment does not provide — the generated preset would refuse to mount.`
}

/**
 * Resolve the platform base preset patch one `--base` composes.
 *
 * The module graph is probed FIRST: a desktop/Electron host resolves the bundle package inside
 * `app.asar`, where no file walk reaches — the platform packages are not on disk at all. The file
 * candidates (the target profile's own `node_modules`, then the unpacked Electron resource scope,
 * then a source checkout, then a global install, then `DSH_AGENT_PRESET_ROOT`) and the loud failure
 * live in core's `resolveBasePresetPatch`.
 * @param base - the base name from `evolution-agent/bases.json`.
 * @param target - the profile target, when one is mounted.
 * @returns the patch file's absolute path.
 */
export function resolvePresetBasePatch(base: string, target: PresetProfileTarget | undefined): string {
  return resolveBasePresetPatch(base, {
    root: process.env['DSH_AGENT_PRESET_ROOT'],
    resolve: moduleGraphPath,
    profileDir: target?.profileDir,
    bundles: target?.bundles,
    // The walk-up ANCHOR, not an asset: every candidate under it is optional, and the published
    // layout anchors the same way (`lib/` instead of `src/`). Spelled as the module's own directory
    // — the family's idiom for it (`install-layered.mjs` does the same) — because a `new URL('.')`
    // reference reads to the packaging guard as an undeclared package-root asset (G6 repair).
    fromDir: dirname(fileURLToPath(import.meta.url)),
  })
}

/**
 * The module-graph probe used by {@link resolvePresetBasePatch}.
 *
 * `import.meta.resolve` is the only lookup an Electron main process performs asar-aware, so it is
 * the candidate that reaches the platform packages inside `resources/app.asar`. The function is
 * optional in the runtime and the probe is a candidate, not a requirement: core treats a throw as a
 * miss and continues down the file chain.
 * @param specifier - the package-relative specifier to resolve.
 * @returns the resolved file path.
 */
function moduleGraphPath(specifier: string): string {
  const resolve = (import.meta as { resolve?: (specifier: string) => string }).resolve
  if (typeof resolve !== 'function') throw new Error('import.meta.resolve is unavailable in this runtime')
  return fileURLToPath(resolve(specifier))
}
