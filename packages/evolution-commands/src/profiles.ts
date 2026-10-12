/**
 * The ONE reader of `<home>/profiles` (G3, 0.22).
 *
 * Two very different questions used to share one bare helper: diagnostics want EVERY profile under
 * the home (doctor's cross-profile summary), while the preset-install exclusion must only ever look
 * at THIS plane — a leftover profile from the other plane's home used to make the exclusion refuse a
 * legitimate install (the two-plane split made that reachable: `~/.dsh/profiles/web` sat next
 * to `profiles/desktop`). The directory is therefore read here and nowhere else:
 * `scanProfiles` is the single `readdirSync` of it, `homeProfiles` answers the diagnostic
 * question, and `installExclusionTarget` answers the write-path one — fail-closed, because an
 * unreadable home must never read as "nothing is installed".
 *
 * @module evolution-commands/src/profiles
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'

/** The patch file name inside a profile directory (the platform's own spelling). */
export const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

/** One profile directory under a home. */
export interface HomeProfile {
  /** The profile's directory name (what `--profile` spells). */
  readonly profile: string
  /** Its absolute (or home-relative-joined) directory. */
  readonly dir: string
}

/** The outcome of reading `<home>/profiles`: the entries, or why they could not be read. */
export type ProfilesScan =
  | { readonly kind: 'scanned'; readonly profiles: readonly HomeProfile[] }
  | { readonly kind: 'unreadable'; readonly error: unknown }

/** The ONLY directory read of `<home>/profiles` in the family.
 * `profiles/node_modules` is a platform-created directory that never carries a manifest (S2.1), dot-entries
 * are not profiles, and a directory without `package.json` is not one either.
 * @param home - the resolved DSH home.
 * @returns the scanned entries, or the enumeration error (never a silent empty list).
 */
export function scanProfiles(home: string): ProfilesScan {
  const root = join(home, 'profiles')
  if (!existsSync(root)) return { kind: 'scanned', profiles: [] }
  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch (error) {
    return { kind: 'unreadable', error }
  }
  const profiles: HomeProfile[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    if (entry.name === 'node_modules') continue
    const dir = join(root, entry.name)
    if (!existsSync(join(dir, 'package.json'))) continue
    profiles.push({ profile: entry.name, dir })
  }
  return { kind: 'scanned', profiles }
}

/** Every profile directory under one home, by name — the DIAGNOSTIC question (doctor's cross-profile
 * summary). An unreadable home answers the empty list here because doctor reports the failure on its
 * own DEGRADED row; a write path must ask {@link installExclusionTarget} instead.
 * @param home - the resolved DSH home.
 * @returns one entry per profile directory carrying a manifest.
 */
export function homeProfiles(home: string): readonly HomeProfile[] {
  const scan = scanProfiles(home)
  return scan.kind === 'scanned' ? scan.profiles : []
}

/** The bundle names one profile's manifest declares.
 * @param profileDir - the profile directory.
 * @param onError - called with the read/parse failure; a torn manifest is NOT "no bundles".
 * @returns the declared bundle names (empty when the manifest is absent).
 */
export function profileBundles(profileDir: string, onError?: (error: unknown) => void): string[] {
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: unknown } } }
    const bundles = manifest.dsh?.profile?.bundles
    return Array.isArray(bundles) ? bundles.filter((name): name is string => typeof name === 'string') : []
  } catch (error) {
    onError?.(error)
    return []
  }
}

/** One optional file's text, or `''` when it is absent or unreadable.
 * @param path - the file to read.
 * @returns the text.
 */
export function readTextOrEmpty(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/** The profile's own patch text, or `''` when it has none.
 * @param profileDir - the profile directory.
 * @returns the patch text.
 */
export function profilePatchText(profileDir: string): string {
  return readTextOrEmpty(join(profileDir, PROFILE_PATCH_FILENAME))
}

/** The profile this PROCESS is mounted in, as the write-path exclusion must see it. */
export interface MountedProfile {
  /** The mounted profile's name. */
  readonly profile: string
  /** Its directory. */
  readonly dir: string
  /** The bundles this plane actually STARTED (the platform's `startedBundles`). */
  readonly bundles: readonly string[]
}

/** Where the preset-install exclusion must look: THIS plane only, or an explicit refusal.
 *
 * The write path does NOT scan the home: the mounted profile is the whole question (its started
 * bundles plus the ones its own manifest declares — either can double-mount), and a question that
 * cannot be answered still REFUSES. That is what makes a leftover profile from the other plane
 * harmless here: it is not this plane's profile, so it is never consulted.
 * @param mounted - the mounted profile, or undefined outside a profile (a bare library mount).
 * @returns the profile to judge with its bundle rows, or the reason a refusal is mandatory.
 */
export function installExclusionTarget(
  mounted: MountedProfile | undefined,
): { readonly kind: 'mounted'; readonly profile: HomeProfile; readonly bundles: readonly string[] } | { readonly kind: 'undecidable'; readonly reason: string } {
  if (mounted === undefined || mounted.dir === '') {
    return { kind: 'undecidable', reason: '本进程没有挂载 profile，因此无法在这里回答双挂载问题' }
  }
  let manifestFailure: unknown
  const declared = profileBundles(mounted.dir, (error) => { manifestFailure = error })
  // ENOENT means the profile simply has no manifest (nothing declared, nothing to double-mount);
  // anything else — EACCES/EIO, or a torn JSON body — is the v34 INST-01 direction and refuses.
  const manifestCode = (manifestFailure as { code?: string } | undefined)?.code
  if (manifestFailure !== undefined && manifestCode !== 'ENOENT') {
    return { kind: 'undecidable', reason: '读不出已挂载 profile 的清单' }
  }
  return {
    kind: 'mounted',
    profile: { profile: mounted.profile, dir: mounted.dir },
    bundles: [...mounted.bundles, ...declared],
  }
}
