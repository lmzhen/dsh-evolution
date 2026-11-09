// line-adapter.mjs — repo-owned family test-bed line resolver (single implementation, G1.1).
//
// Why it exists: the bed used to resolve its packages through an ordered alias chain written
// inline in vitest-family-preflight.mjs, with NO record of which LINE each package came from —
// so a machine-state change (a profile install, a global dsh upgrade, an overlay edit) silently
// redefined what "green" meant. Two of the six sources are machine state; drift already happened
// once during the 0.22.0 release (the preflight comment still claimed the npm closure was 0.1.5
// while it had become 0.2.0-rc.2).
//
// This module is the ONLY place that knows the order and the kinds. It returns both the vitest
// alias list (behaviour identical to before) and a manifest-ready entry list.
//
// Every path is overridable by env so the line-identity drill can point a source at an old tree
// WITHOUT editing any file:
//   FAMILY_LINE_MONO / FAMILY_LINE_EVO / FAMILY_LINE_PROFILE / FAMILY_LINE_UPSTREAM / FAMILY_LINE_CLOSURE
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

// 遗留⑤ (2026-10-19): DEFAULTS are DERIVED, never a machine snapshot. The env layer above still
// wins for every field (FAMILY_LINE_*), so the line-identity drill can point any source at another
// tree without editing this file; a replay on another machine starts from these defaults and
// `node packages/scripts/verify-env.mjs` prints what they resolved to.
const HERE = dirname(fileURLToPath(import.meta.url))
// Repo-owned port of the line adapter. Mirror layout: <repo>/packages/scripts;
// overlay layout: <platform>/packages/evolution/scripts. WORKSPACE is the
// containing repository root in both shapes.
const PARENT_NAME = dirname(HERE).split(/[\\/]/).pop()
const WORKSPACE = PARENT_NAME === 'evolution' ? resolve(HERE, '..', '..', '..') : resolve(HERE, '..', '..')
const PLATFORM_ROOT = existsSync(join(WORKSPACE, 'packages', 'boot', 'app-boot')) ? WORKSPACE : undefined
const firstExisting = (candidates) => candidates.find((dir) => typeof dir === 'string' && dir !== '' && existsSync(dir))
const NPM_GLOBAL = (() => {
  try {
    const out = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (out !== '') return out
  } catch { /* fall through to the platform default */ }
  const roaming = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  return firstExisting([join(roaming, 'npm', 'node_modules'), join(homedir(), '.npm-global', 'lib', 'node_modules')]) ?? join(roaming, 'npm', 'node_modules')
})()
const MONO = firstExisting([
  process.env.FAMILY_LINE_MONO,
  PLATFORM_ROOT,
  join(WORKSPACE, 'harness-0.2.1'),
  join(WORKSPACE, 'deepseek-harness'),
  join(homedir(), 'harness-0.2.1'),
]) ?? join(WORKSPACE, 'harness-0.2.1')
const UPSTREAM = firstExisting([
  process.env.FAMILY_LINE_UPSTREAM,
  join(WORKSPACE, 'dsh-upstream-0.2.1-rc.3', 'packages'),
  join(WORKSPACE, 'dsh-upstream-0.2.1-rc.2', 'packages'),
  join(WORKSPACE, 'dsh-upstream-0.2.0-rc.2-overlay', 'packages'),
]) ?? join(WORKSPACE, 'dsh-upstream-0.2.1-rc.3', 'packages')
const ZOD = (() => {
  const store = join(MONO, 'node_modules', '.pnpm')
  try {
    const hit = readdirSync(store).filter((name) => /^zod@[0-9]/.test(name)).sort().pop()
    if (hit !== undefined) return join(store, hit, 'node_modules', 'zod')
  } catch { /* a missing store is 'no zod', not a crash */ }
  return join(MONO, 'node_modules', '.pnpm', 'zod@4.4.3', 'node_modules', 'zod')
})()
export const DEFAULTS = {
  mono: MONO,
  profileDir: join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', '@deepseek-ai'),
  closureDir: join(NPM_GLOBAL, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'),
  upstreamPackages: UPSTREAM,
  zod: ZOD,
  policy: join(HERE, 'line-policy.json'),
  /** The dev tree's pnpm store — where the CLIENT test dependencies (react/react-dom/testing-library)
   * live. Resolved by glob instead of a pinned version so a store bump does not silently break the
   * client lane (the platform's own versions are what the family's client halves compile against). */
  store: join(MONO, 'node_modules', '.pnpm'),
}

/** Third-party TEST dependencies the family's client specs import, resolved from the pnpm store. */
const STORE_LIBS = ['react', 'react-dom', '@testing-library/react', '@testing-library/dom', 'jsdom']

/** The repo-side line policy (frozen contract C1). Load-bearing: it decides which platform
 * packages may be hoisted from the MUTABLE profile dir. Undeclared ones are not hoisted at all —
 * a hoist that silently shadows the closure is exactly the drift this module exists to stop. */
export function readPolicy(env = process.env) {
  const path = env.FAMILY_LINE_POLICY ?? DEFAULTS.policy
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return { profileHoist: {} } }
}

/** Sources, in resolution order. `kind` is the line vocabulary the gate checks. */
export function paths(env = process.env) {
  const mono = env.FAMILY_LINE_MONO ?? DEFAULTS.mono
  return {
    mono,
    evo: env.FAMILY_LINE_EVO ?? join(mono, 'packages/evolution'),
    profileDir: env.FAMILY_LINE_PROFILE ?? DEFAULTS.profileDir,
    closureDir: env.FAMILY_LINE_CLOSURE ?? DEFAULTS.closureDir,
    upstreamPackages: env.FAMILY_LINE_UPSTREAM ?? DEFAULTS.upstreamPackages,
    zod: env.FAMILY_LINE_ZOD ?? DEFAULTS.zod,
    store: env.FAMILY_LINE_STORE ?? DEFAULTS.store,
    vendor: env.FAMILY_LINE_VENDOR ?? join(mono, 'vendor'),
  }
}

const readName = (pkgPath) => {
  try { return JSON.parse(readFileSync(pkgPath, 'utf8')).name } catch { return undefined }
}

  // Built JS wins over source for PLATFORM packages: the mono/vendor sources use syntax the test
  // transform may not accept (e.g. explicit-resource-management), while `lib/index.js` is the exact
  // artifact the release line ships. Source is the fallback for packages not yet built.
  const platformEntry = (dir) => {
    const built = join(dir, 'lib', 'index.js')
    if (existsSync(built)) return built
    const source = join(dir, 'src', 'index.ts')
    return existsSync(source) ? source : undefined
  }

/** All entries the bed resolves, in the SAME order the preflight always used. */
export function resolveEntries(env = process.env) {
  const p = paths(env)
  const entries = []
  // Built platform libs import package SUBPATH exports (e.g. dsh-compaction-image-offload/projection);
  // a root-only alias would resolve `pkg/sub` as a filesystem path. Register each declared export
  // subpath as its own alias so the alias chain can serve the produced JS faithfully.
  const addSubpaths = (id, dir) => {
    let pkg
    try { pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) } catch { return }
    const exportsField = pkg?.exports
    if (exportsField === undefined || typeof exportsField !== 'object' || exportsField === null) return
    for (const [key, value] of Object.entries(exportsField)) {
      if (!key.startsWith('./')) continue
      const target = typeof value === 'string' ? value : (value?.default ?? value?.import)
      if (typeof target !== 'string') continue
      const resolved = join(dir, target)
      if (!existsSync(resolved)) continue
      add(id + key.slice(1), 'mono-subpath', resolved, 'platform export subpath')
    }
  }
  const seen = new Set()
  const add = (id, kind, resolvedPath, source) => {
    if (typeof id !== 'string' || seen.has(id)) return
    seen.add(id)
    entries.push({ id, kind, resolvedPath, source })
  }
  add('zod', 'store', p.zod, 'zod@4.4.3 (mono pnpm store)')
  // The client specs (`// @vitest-environment jsdom`) import React and testing-library: without these
  // aliases the whole client lane fails at import time (the bed resolved no `react` at all), which is
  // why the family's 8 client specs were red for reasons unrelated to their subject.
  for (const lib of STORE_LIBS) {
    const flat = lib.replace('/', '+')
    let dirs = []
    try { dirs = readdirSync(p.store, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith(flat + '@')) } catch { dirs = [] }
    for (const dir of dirs) {
      const candidate = join(p.store, dir.name, 'node_modules', ...lib.split('/'))
      if (!existsSync(candidate)) continue
      add(lib, 'store', candidate, 'pnpm store (client test dependency)')
      break
    }
  }
  // 2a. frozen core subpaths (G0): alias matching treats a find string as a prefix, so the subpaths
  //     must be declared BEFORE the root package alias or they resolve to <root>/composition.
  {
    const coreSrcDir = join(p.evo, 'evolution-core', 'src')
    add('@deepseek-ai/dsh-evolution-core/composition', 'evo-subpath', join(coreSrcDir, 'composition/index.ts'), 'overlay src subpath')
    add('@deepseek-ai/dsh-evolution-core/subagent', 'evo-subpath', join(coreSrcDir, 'subagent/index.ts'), 'overlay src subpath')
    add('@deepseek-ai/dsh-evolution-core/http-routes', 'evo-subpath', join(coreSrcDir, 'http-routes.ts'), 'overlay src subpath')
    add('@deepseek-ai/dsh-evolution-core/restrictor', 'evo-subpath', join(coreSrcDir, 'restrictor.ts'), 'overlay src subpath')
  }
  // 2a. client-kit subpaths must be declared BEFORE the root package alias (prefix matching).
  {
    const kitSrc = join(p.evo, 'evolution-client-kit', 'src')
    add('@lmzhen/dsh-evolution-client-kit/generated/contracts', 'kit-subpath', join(kitSrc, 'generated/contracts.generated.ts'), 'overlay src subpath')
    add('@lmzhen/dsh-evolution-client-kit/generated/fallbacks', 'kit-subpath', join(kitSrc, 'generated/fallbacks.generated.ts'), 'overlay src subpath')
    add('@lmzhen/dsh-evolution-client-kit/generated/route-client', 'kit-subpath', join(kitSrc, 'generated/route-client.generated.ts'), 'overlay src subpath')
    add('@lmzhen/dsh-evolution-client-kit/generated/routes', 'kit-subpath', join(kitSrc, 'generated/routes.generated.ts'), 'overlay src subpath')
    add('@lmzhen/dsh-evolution-client-kit/generated/states', 'kit-subpath', join(kitSrc, 'generated/states.generated.ts'), 'overlay src subpath')
    add('@lmzhen/dsh-evolution-client-kit/tokens', 'kit-subpath', join(kitSrc, 'tokens.ts'), 'overlay src subpath')
    for (const ns of ['evolution-settings', 'evolution-skill-history', 'evolution-merge', 'evolution-skill-health']) {
      add('@lmzhen/dsh-evolution-client-kit/generated/i18n/' + ns, 'kit-subpath', join(kitSrc, 'generated/i18n', ns + '.ts'), 'overlay src subpath')
    }
  }
  // 2. the family's own packages, from the dev overlay SOURCE (the tree the tests exercise).
  if (existsSync(p.evo)) {
    for (const dir of readdirSync(p.evo, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue
      const pkgPath = join(p.evo, dir.name, 'package.json')
      const src = join(p.evo, dir.name, 'src/index.ts')
      if (!existsSync(pkgPath) || !existsSync(src)) continue
      add(readName(pkgPath), 'evo-src', src, 'overlay src')
    }
  }
  // 3. profile-hoisted platform packages — ONLY the ones the policy declares (MACHINE STATE).
  //    Whitelist on purpose: schemastery 3.18.4 carries the runtime .volatile() the closure's
  //    3.18.2 lacks; dsh-tool-session-query exists only in the profile. Anything else must NOT be
  //    hoisted (it would shadow the closure's copy — the cosmokit/dsh-brand case the gate flagged).
  const hoistPolicy = readPolicy(env).profileHoist ?? {}
  const mayHoist = (id) => hoistPolicy[id] !== undefined && hoistPolicy[id].status !== 'undeclared'
  if (existsSync(p.profileDir)) {
    for (const dir of readdirSync(p.profileDir, { withFileTypes: true })) {
      const id = '@deepseek-ai/' + dir.name
      if (!mayHoist(id)) continue
      add(id, 'profile-hoist', join(p.profileDir, dir.name), 'desktop profile node_modules (' + (hoistPolicy[id].status) + ')')
    }
  }
  // 4. the PINNED upstream line, whitelisted on purpose (core/tools carries ToolDefinition.timeoutMs).
  for (const rel of ['core/tools']) {
    const pkgPath = join(p.upstreamPackages, rel, 'package.json')
    const src = join(p.upstreamPackages, rel, 'src/index.ts')
    if (!existsSync(pkgPath) || !existsSync(src)) continue
    add(readName(pkgPath), 'upstream', src, 'pinned upstream whitelist')
  }
  // 5. the monorepo SOURCE and the VENDORED platform packages — BEFORE the npm closure: the bed
  //    must resolve ONE platform line. Once the globally installed dsh moved to a newer version,
  //    closure-first resolution split class identity (ToolRuntime/PtcRuntime provider from one copy,
  //    runtime from another) and child processes resolved the family's unbuilt workspace copies.
  //    Mono source wins; the closure becomes a LAST-RESORT fallback for packages absent here.
  {
    const packagesRoot = join(p.mono, 'packages')
    if (existsSync(packagesRoot)) {
      for (const group of readdirSync(packagesRoot, { withFileTypes: true })) {
        if (!group.isDirectory()) continue
        const groupPath = join(packagesRoot, group.name)
        for (const pkg of readdirSync(groupPath, { withFileTypes: true })) {
          if (!pkg.isDirectory()) continue
          const pkgPath = join(groupPath, pkg.name, 'package.json')
          const resolved = platformEntry(join(groupPath, pkg.name))
          if (!existsSync(pkgPath) || resolved === undefined) continue
          const id = readName(pkgPath)
          // Subpath aliases MUST precede the root alias: Vite matches `find` as a prefix, so the
          // root mapping would swallow `pkg/sub` and append the subpath as a filesystem segment.
          if (typeof id === 'string') addSubpaths(id, join(groupPath, pkg.name))
          add(id, 'mono', resolved, 'monorepo packages')
        }
      }
    }
  }
  {
    // Vendor packages (cordis/schemastery/cordis-plugin-include/loader/cosmokit) live under
    // <mono>/vendor, outside the packages scan; without them a closure-free bed cannot resolve
    // the runtime core at all.
    if (existsSync(p.vendor)) {
      for (const dir of readdirSync(p.vendor, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue
        const pkgPath = join(p.vendor, dir.name, 'package.json')
        const resolved = platformEntry(join(p.vendor, dir.name))
        if (!existsSync(pkgPath) || resolved === undefined) continue
        const id = readName(pkgPath)
        if (typeof id === 'string') addSubpaths(id, join(p.vendor, dir.name))
        add(id, 'vendor', resolved, 'vendored platform packages')
      }
    }
  }
  {
    // Native workspace packages (e.g. @deepseek-ai/node-addon-system under native/system/packages)
    // sit outside both scans; built platform libs import their export subpaths directly.
    const nativeRoot = join(p.mono, 'native')
    const walk = (dir, depth) => {
      if (depth > 4) return
      let entries
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const child = join(dir, entry.name)
        const pkgPath = join(child, 'package.json')
        if (existsSync(pkgPath)) {
          const id = readName(pkgPath)
          if (typeof id === 'string' && id.startsWith('@deepseek-ai/')) {
            const resolved = platformEntry(child)
            addSubpaths(id, child)
            if (resolved !== undefined) add(id, 'native', resolved, 'native workspace package')
          }
        }
        walk(child, depth + 1)
      }
    }
    walk(nativeRoot, 0)
  }
  // 5. the global npm closure (MACHINE STATE: follows the globally installed dsh).
  if (existsSync(p.closureDir)) {
    for (const dir of readdirSync(p.closureDir, { withFileTypes: true })) {
      if (!dir.isDirectory() && !dir.isSymbolicLink()) continue
      add('@deepseek-ai/' + dir.name, 'closure', join(p.closureDir, dir.name), 'npm closure')
    }
  }
  // Platform packages resolve through the harness checkout's OWN node_modules (pnpm workspace
  // symlinks → built lib/index.js). Aliasing them to a single file broke package SUBPATH exports
  // (`pkg/projection`) and mixed copies; after the build line gained built artifacts the plain FS
  // resolution is both correct and the closest match to what ships. Set
  // FAMILY_LINE_PLATFORM_ALIASES=1 to restore the legacy alias chain for line-identity drills.
  return entries
}

/** The vitest alias list — same order, same dedup, as the preflight always produced. */
export function resolveAliases(env = process.env) {
  return resolveEntries(env).map(({ id, resolvedPath }) => ({ find: id, replacement: resolvedPath }))
}
