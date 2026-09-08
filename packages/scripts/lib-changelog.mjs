/**
 * Shared CHANGELOG head-version parser (G3, v11) — used by
 * normalize-mirror.mjs and verify-layout-sync.mjs so the two guards can never
 * disagree on the accepted version shape (a prerelease head like `0.4.0-rc.1`
 * was accepted by verify but truncated to `0.4.0` by normalize).
 */

/** First `## x.y.z` heading of a CHANGELOG, or null when absent.
 * Accepts stable and prerelease versions (`-rc.1`, `-beta.2`, …). */
export function changelogHead(changelog) {
  return /^## (\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)/m.exec(changelog)?.[1] ?? null
}
