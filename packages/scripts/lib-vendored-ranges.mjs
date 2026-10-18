/**
 * The vendored framework ranges the release metadata pins (ONE source).
 *
 * These are NOT platform-line values: each is pinned to the validated upstream tree's vendored
 * package version (vendor/<dir>/package.json), not to the family's release version and not to a
 * convenience floor. prepare-release writes these into manifests; verify-platform-ranges asserts
 * them, so a new @deepseek-ai/* non-dsh dependency cannot ship without a rule here.
 */
export const VENDORED_RANGES = Object.freeze({
  '@deepseek-ai/cordis': '^4.0.5',
  '@deepseek-ai/schemastery': '^3.18.5',
  '@deepseek-ai/cordis-plugin-include': '^1.0.10',
})

/** Vendored package -> upstream vendor directory (for the --upstream cross-check). */
export const VENDORED_DIRS = Object.freeze({
  '@deepseek-ai/cordis': 'cordis',
  '@deepseek-ai/schemastery': 'schemastery',
  '@deepseek-ai/cordis-plugin-include': 'include',
})

/** @param name - a dependency name. @returns its pinned range, or undefined when not vendored. */
export function vendoredRangeFor(name) {
  return VENDORED_RANGES[name]
}
