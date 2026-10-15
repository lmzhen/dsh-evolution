/**
 * G1/1.8 (G-04): the SCOPE this build was published under, DERIVED from a manifest instead of written as a
 * literal in running code.
 *
 * The family used to hard-code `@deepseek-ai/dsh-...` names and let `prepare-release.mjs --scope @lmzhen`
 * patch the text afterwards. A published install therefore depended on a release-time string rewrite
 * reaching every copy, and the copies had already drifted (doctor.ts, index.ts, preset-composition.ts and
 * its .mjs mirror each spelled the identity). The scope is knowable at runtime: it is the scope segment of
 * the nearest `package.json` above the calling module. Nothing to rewrite, one owner of the answer.
 *
 * @module @deepseek-ai/dsh-evolution-core/package-identity
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The scope segment of the nearest `package.json` at or above `from`.
 * @param from - the calling module URL (its own manifest is the answer).
 * @returns the scope, e.g. `@deepseek-ai` or `@lmzhen`; an unscoped manifest yields an empty string.
 */
export function scopeOfNearestManifest(from: string | URL): string {
  let dir = dirname(from instanceof URL ? fileURLToPath(from) : fileURLToPath(new URL(from)))
  for (let hops = 0; hops < 32; hops += 1) {
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }
      const name = typeof parsed.name === 'string' ? parsed.name : ''
      return name.startsWith('@') ? (name.split('/')[0] ?? '') : ''
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return ''
}

/**
 * One family/platform package name under the RUNNING scope.
 * @param bareName - the name without any scope, e.g. `dsh-agent-preset`.
 * @param from - the calling module URL.
 * @returns `scope/bareName`, or `bareName` when the manifest carries no scope.
 */
export function scopedPackageName(bareName: string, from: string | URL): string {
  const scope = scopeOfNearestManifest(from)
  return scope === '' ? bareName : scope + '/' + bareName
}
