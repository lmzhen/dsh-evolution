/**
 * Evolution home path helper: `$DSH_HOME/evolution` for plugin-owned sidecar
 * state (reports, activity store, feedback file, state-domain data).
 */

import { join } from 'node:path'
import { homedir } from 'node:os'

export function evolutionHome(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.DSH_HOME ?? join(homedir(), '.dsh'), 'evolution')
}
