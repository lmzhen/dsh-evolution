/**
 * lib-env.mjs — portable root resolver for the mirror-side fixtures (遗留⑤, 2026-10-19).
 *
 * Why: the test bed and several gate scripts carried MACHINE paths (D:/dsh/deepseek-harness,
 * the user web profile, the global npm closure). Those are environment facts, not repo facts: a
 * replay on another machine must find its own trees or fail with a NAMED reason instead of
 * silently judging the wrong tree. Resolution order everywhere:
 *   explicit flag -> env -> workspace candidate -> platform-layout candidate -> documented default
 * Run `node packages/scripts/verify-env.mjs` (add --json for the machine form) to print the
 * resolution table; a replay starts from that table, not from a mystery.
 *
 * Both layouts must work with the same bytes:
 *   mirror:  <repo>/packages/scripts/*.mjs             packages root = <repo>/packages
 *   overlay: <platform>/packages/evolution/scripts/*   packages root = <platform>/packages/evolution
 */
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

export const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))
const PARENT = dirname(SCRIPTS_DIR)
const PARENT_NAME = PARENT.split(/[\\/]/).pop()
/** True when this file lives in the mirror layout (<repo>/packages/scripts). */
export const MIRROR_LAYOUT = PARENT_NAME !== 'evolution'
/** The directory that holds the family packages (mirror: packages; overlay: packages/evolution). */
export const PACKAGES_ROOT = MIRROR_LAYOUT ? resolve(SCRIPTS_DIR, '..') : resolve(SCRIPTS_DIR, '..', '..')
/** The git/repo root this file belongs to (mirror: the mirror; overlay: the platform checkout). */
export const REPO_ROOT = MIRROR_LAYOUT ? resolve(PACKAGES_ROOT, '..') : resolve(PACKAGES_ROOT, '..', '..')

const unique = (list) => [...new Set(list)]
const isPlatformTree = (root) => existsSync(join(root, "packages", "boot", "app-boot")) && existsSync(join(root, "node_modules", "vitest"))

/** Candidate platform/overlay trees: env first, then disposable build lines, then the CI parent layout. */
export function overlayCandidates(env = process.env) {
  const workspace = resolve(REPO_ROOT, "..")
  const list = []
  if (typeof env.EVOLUTION_OVERLAY_ROOT === "string" && env.EVOLUTION_OVERLAY_ROOT !== "") list.push(resolve(env.EVOLUTION_OVERLAY_ROOT))
  for (const name of ["harness-0.2.1", "deepseek-harness"]) list.push(join(workspace, name))
  list.push(resolve(PACKAGES_ROOT, ".."))
  return unique(list)
}
export function resolveOverlay(env = process.env) { return overlayCandidates(env).find(isPlatformTree) ?? null }

/** Candidate profile home directories (the bed hoists two platform packages from the live profile). */
export function profileCandidates(env = process.env) {
  const workspace = resolve(REPO_ROOT, "..")
  const list = []
  if (typeof env.EVOLUTION_PROFILE === "string" && env.EVOLUTION_PROFILE !== "") list.push(resolve(env.EVOLUTION_PROFILE))
  list.push(join(resolve(workspace, ".."), "dsh-homes", "web", "profiles", "web"))
  list.push(join(homedir(), ".dsh", "profiles", "desktop"))
  return unique(list)
}
export function resolveProfile(env = process.env) { return profileCandidates(env).find((dir) => existsSync(join(dir, "package.json"))) ?? null }

/** npm global root: env -> `npm root -g` -> platform defaults. */
export function npmGlobalRoot(env = process.env) {
  if (typeof env.FAMILY_NPM_GLOBAL === "string" && env.FAMILY_NPM_GLOBAL !== "") return resolve(env.FAMILY_NPM_GLOBAL)
  try {
    const out = execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
    if (out !== "") return out
  } catch { /* the fallback below is the documented default, not a hidden failure */ }
  const roaming = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")
  const candidates = [join(roaming, "npm", "node_modules"), join(homedir(), ".npm-global", "lib", "node_modules")]
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0]
}

/** The external line resolver adapter (the ONLY place that knows the resolution order). */
export function adapterCandidates(env = process.env) {
  const workspace = resolve(REPO_ROOT, "..")
  const list = []
  if (typeof env.FAMILY_LINE_ADAPTER === "string" && env.FAMILY_LINE_ADAPTER !== "") list.push(resolve(env.FAMILY_LINE_ADAPTER))
  list.push(join(workspace, "_tools", "lib-line.mjs"))
  list.push(join(homedir(), "dsh", "_tools", "lib-line.mjs"))
  return unique(list)
}
export function resolveAdapter(env = process.env) { return adapterCandidates(env).find((file) => existsSync(file)) ?? null }
export function toolingDir(env = process.env) {
  const adapter = resolveAdapter(env)
  return adapter === null ? null : dirname(adapter)
}

const described = (label, resolved, candidates) => ({ label, resolved, candidates })
export function describe(env = process.env) {
  return {
    layout: MIRROR_LAYOUT ? "mirror" : "overlay",
    scriptsDir: SCRIPTS_DIR,
    packagesRoot: PACKAGES_ROOT,
    repoRoot: REPO_ROOT,
    overlay: described("platform overlay", resolveOverlay(env), overlayCandidates(env)),
    profile: described("test-bed profile", resolveProfile(env), profileCandidates(env)),
    adapter: described("line resolver adapter", resolveAdapter(env), adapterCandidates(env)),
    npmGlobal: npmGlobalRoot(env),
  }
}

/** Loud accessors: a replay with a missing fixture stops with the candidates named. */
function requireNamed(kind, value, envVar, candidates) {
  if (value !== null) return value
  throw new Error("cannot resolve " + kind + ": set " + envVar + " — candidates: " + candidates.join(", "))
}
export function requireOverlay(env = process.env) { return requireNamed("the platform overlay", resolveOverlay(env), "EVOLUTION_OVERLAY_ROOT", overlayCandidates(env)) }

/**
 * Soft resolution for callers that tolerate an ABSENT platform tree: returns the resolved tree,
 * else the first documented candidate path (which may not exist). Executors such as run-gates turn
 * a missing overlay into a `cannot-decide` record with cause artifact-absent — throwing at import
 * time would kill the JSON envelope (0.27.1 vacuum fixture caught exactly that).
 */
export function softOverlay(env = process.env) { return resolveOverlay(env) ?? overlayCandidates(env)[0] }
export function softProfile(env = process.env) { return resolveProfile(env) ?? profileCandidates(env)[0] }
export function requireProfile(env = process.env) { return requireNamed("the test-bed profile", resolveProfile(env), "EVOLUTION_PROFILE", profileCandidates(env)) }
export function requireAdapter(env = process.env) { return requireNamed("the line resolver adapter", resolveAdapter(env), "FAMILY_LINE_ADAPTER", adapterCandidates(env)) }
