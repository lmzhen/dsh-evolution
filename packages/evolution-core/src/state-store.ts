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

import { join } from 'node:path'
import { homedir } from 'node:os'

/**
 * DSH home root: `$DSH_HOME` or `~/.dsh`. Single source of the empty-string
 * fallback — an EMPTY or WHITESPACE-ONLY DSH_HOME resolves to the default
 * home, never to a CWD-relative path (0.3.19 W1.3, 0.3.22 F-207);
 * V8-06 (0.3.47) extends the guard to whitespace (upstream home-paths:
 * `trim().length > 0` is the adoption test — `DSH_HOME=" "` must not produce
 * a sidecar under a relative "." path).
 * C-11: the adoption test and the RETURNED value now come from the
 * SAME trimmed source — the old form tested `trim()` but returned the raw
 * value, so `DSH_HOME=" /x "` was accepted AND persisted with literal spaces.
 * Known tradeoff vs upstream `resolveDshHome`: `~` is NOT expanded here —
 * documented as a deliberate difference in the v10 audit; revisit only if a
 * real deployment needs it.
 */
export function evolutionRoot(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.DSH_HOME?.trim()
  return home ? home : join(homedir(), '.dsh')
}

/** Evolution home path helper: `$DSH_HOME/evolution` for plugin-owned sidecar
 * state (reports, activity store, feedback file, state-domain data). */
export function evolutionHome(env: NodeJS.ProcessEnv = process.env): string {
  return join(evolutionRoot(env), 'evolution')
}
