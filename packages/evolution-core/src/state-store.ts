/**
 * Evolution home path helper: `$DSH_HOME/evolution` for plugin-owned sidecar
 * state (reports, activity store, feedback file, state-domain data).
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
 */
export function evolutionRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.DSH_HOME?.trim() ? env.DSH_HOME : join(homedir(), '.dsh')
}

/** Evolution home path helper: `$DSH_HOME/evolution` for plugin-owned sidecar
 * state (reports, activity store, feedback file, state-domain data). */
export function evolutionHome(env: NodeJS.ProcessEnv = process.env): string {
  return join(evolutionRoot(env), 'evolution')
}
