/**
 * Evolution home path helpers: the DSH root and `$DSH_HOME/evolution` for
 * plugin-owned sidecar state (reports, activity store, feedback file,
 * state-domain data).
 *
 * C-10: PATH HELPERS ONLY — despite the file name there is no store
 * here. Durable evolution state lives in the state stack (evolution-state over
 * evolution-state-json / -domain); skills and memories live in skill-store.ts
 * / memory-store.ts. The file name is kept deliberately: renaming it would
 * touch every family import for zero behavior change, and the audit records
 * the mismatch as known naming debt.
 */

import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

/**
 * DSH home root: `$DSH_HOME` or `~/.dsh`. Single source of the empty-string
 * fallback — an EMPTY or WHITESPACE-ONLY DSH_HOME resolves to the default
 * home, never to a CWD-relative path (0.3.19 W1.3, 0.3.22 F-207);
 * V8-06 (0.3.47) extends the guard to whitespace.
 * C-11 correction (S2.2, PLAN 2026-09-16): upstream `resolveDshHome`
 * (util/home-paths) uses `trim()` ONLY as the ADOPTION test and then uses the
 * RAW env value — the earlier "same trimmed source" form returned the trimmed
 * text, so `DSH_HOME=" /x "` produced `/x` where upstream produced the literal
 * padded path. The value semantics now match upstream line for line:
 * `const selected = configured ?? (fromEnv !== undefined &&
 * fromEnv.trim().length > 0 ? fromEnv : defaultDshHome())`.
 * OPT-27 (2026-09, plan D5 — accepted): the v10-era "no `~` expansion, no
 * resolve" divergence from upstream `resolveDshHome` is RETIRED. It became
 * load-bearing when the skill-catalog shadow made "same tree as the upstream
 * `USER_DSH_RANK` provider" a hard contract: upstream watches the EXPANDED
 * absolute `<home>/skills` while this value fed a literal `~/x` (a directory
 * named `~` under the host CWD) or a CWD-relative path — split-brain skill
 * trees, preset installs the platform never reads, doctor probes of a
 * directory nothing serves.
 * S2.2 (PLAN 2026-09-16), final correction: the result is ALWAYS
 * `resolve(expandHomePath(selected))` — the earlier form returned an
 * already-absolute value VERBATIM, so a trailing slash or `..` segment
 * landed unnormalized while upstream normalizes every value. Relative
 * `DSH_HOME` values change landing spot; a CLEAN absolute home stays
 * byte-identical (resolve is a no-op on it).
 */
export function evolutionRoot(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.DSH_HOME
  const selected = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')
  // Mirror upstream expandHomePath (util/home-paths): `~` alone is the OS
  // home; `~/` and `~\` prefix the OS home; anything else is taken literally
  // — then resolved to an absolute path like upstream resolveDshHome.
  const expanded = selected === '~'
    ? homedir()
    : selected.startsWith('~/') || selected.startsWith('~\\')
      ? join(homedir(), selected.slice(2))
      : selected
  return resolve(expanded)
}

/** Evolution home path helper: `$DSH_HOME/evolution` for plugin-owned sidecar
 * state (reports, activity store, feedback file, state-domain data). */
export function evolutionHome(env: NodeJS.ProcessEnv = process.env): string {
  return join(evolutionRoot(env), 'evolution')
}
