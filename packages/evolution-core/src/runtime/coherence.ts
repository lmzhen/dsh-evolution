/**
 * Family version coherence probe.
 *
 * A profile can contain one bundle whose implementation packages come from
 * different family releases: the bundle row updates while a directly pinned
 * sibling stays behind, or old hand-copied packages shadow the pnpm tree. The
 * loader then runs an old client against a new host, which looks like a UI
 * regression rather than a mixed install. This probe names that state at
 * startup; it never repairs a live profile (a package-manager write while the
 * host runs is unsafe and needs a restart).
 *
 * @module @deepseek-ai/dsh-evolution-core/runtime/coherence
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { profileContextPort } from '@deepseek-ai/dsh-evolution-adapter/ports'

/** One family package as found in the profile. */
export interface FamilyComponent {
  readonly name: string
  readonly version?: string
}

/** The family coherence result for one profile. */
export interface FamilyCoherence {
  readonly allVersion: string
  readonly components: readonly FamilyComponent[]
  readonly mismatched: readonly FamilyComponent[]
}

function packageTail(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1)
}

/** Family implementation tails; external @deepseek-ai packages stay out. */
function isFamilyPackage(name: string): boolean {
  const tail = packageTail(name)
  return tail.startsWith('dsh-evolution-')
    || tail === 'dsh-memory'
    || tail === 'dsh-memory-files'
    || tail === 'dsh-skill-usage'
    || tail === 'dsh-tool-memory'
    || tail === 'dsh-tool-skill-manage'
}

/**
 * Compare every implementation package with the installed `all` bundle.
 * Missing packages count as a mismatch because the old loader would fall back
 * to an unrelated copy or fail at load.
 * @param profileDir - profile directory containing `package.json` and `node_modules`.
 * @returns The coherence result, or undefined when the profile has no readable `all` bundle.
 */
export function checkFamilyCoherence(profileDir: string): FamilyCoherence | undefined {
  const profileManifest = join(profileDir, 'package.json')
  if (!existsSync(profileManifest)) return undefined
  // Resolve ONLY inside this profile. A createRequire fallback can walk the
  // test/launcher NODE_PATH and report the build tree's packages as installed,
  // which would hide exactly the mixed profile this probe exists to catch.
  const resolveManifest = (name: string): string | undefined => {
    const path = join(profileDir, 'node_modules', name, 'package.json')
    return existsSync(path) ? path : undefined
  }
  const allPath = resolveManifest('@lmzhen/dsh-evolution-all') ?? resolveManifest('@deepseek-ai/dsh-evolution-all')
  if (allPath === undefined) return undefined
  let all: { version?: unknown; dependencies?: Record<string, string> }
  try {
    all = JSON.parse(readFileSync(allPath, 'utf8')) as typeof all
  } catch {
    return undefined
  }
  if (typeof all.version !== 'string') return undefined
  const components: FamilyComponent[] = []
  const visited = new Set<string>()
  const queue = Object.keys(all.dependencies ?? {}).filter(isFamilyPackage)
  while (queue.length > 0) {
    const name = queue.shift()
    if (name === undefined || visited.has(name)) continue
    visited.add(name)
    const manifestPath = resolveManifest(name)
    if (manifestPath === undefined) {
      components.push({ name })
      continue
    }
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        version?: unknown
        dependencies?: Record<string, string>
        optionalDependencies?: Record<string, string>
      }
      components.push({ name, ...(typeof manifest.version === 'string' ? { version: manifest.version } : {}) })
      // The family is a dependency graph, not only the bundle's direct list:
      // client-kit arrives through evolution-ui, merge-engine through merge.
      for (const child of [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
      ]) {
        if (isFamilyPackage(child) && !visited.has(child)) queue.push(child)
      }
    } catch {
      components.push({ name })
    }
  }
  return {
    allVersion: all.version,
    components,
    mismatched: components.filter(component => component.version !== all.version),
  }
}

/**
 * Warn once when the running profile is a mixed family install.
 * @param ctx - the running host context; a bare library mount has no profile and is skipped.
 * @returns The detected mismatch, or undefined when no profile/all bundle is present.
 */
export function warnIfFamilyMixed(ctx: Context): FamilyCoherence | undefined {
  const profile = profileContextPort(ctx)
  if (profile === undefined) return undefined
  const coherence = checkFamilyCoherence(profile.dir)
  if (coherence === undefined || coherence.mismatched.length === 0) return undefined
  const details = coherence.mismatched
    .map(component => `${component.name}@${component.version ?? 'missing'}`)
    .join(', ')
  console.warn(
    `[dsh-evolution] mixed family install: all@${coherence.allVersion} but ${details}; `
    + 'the loaded client may be an older release. Run the profile repair in INSTALL.md before restarting.',
  )
  return coherence
}
