/**
 * Evolution environment-variable reading, single-source (WC, 0.3.56).
 *
 * Every `DSH_EVOLUTION_*` value the PLUGIN code reads goes through this module
 * so the trim/whitelist patterns (v10 P2-12/13) live in exactly one place and
 * the generated env reference can point at one behavior. Configuration-layer
 * reads inside patch YAML `!!js` expressions (session-query path/openAt) stay
 * in the profile config evaluation — they are NOT migrated (they are resolved
 * at cordis config time, not plugin time) but are documented in the README
 * env table.
 */

/** Plugin-side DSH_EVOLUTION_* keys (config-layer keys are documented separately). */
export const EVOLUTION_ENV_KEYS = ['DSH_EVOLUTION_ALLOW_ROW_COLLISIONS'] as const

const ALLOW_ROW_COLLISIONS = '1'

/** N-5 escape: `DSH_EVOLUTION_ALLOW_ROW_COLLISIONS=1` downgrades a delta-row
 * collision from fail-loud to warn+keep-both. Any other value (including an
 * EMPTY/whitespace string — a set-but-unset variable) keeps the fail-loud. */
export function allowRowCollisions(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DSH_EVOLUTION_ALLOW_ROW_COLLISIONS === ALLOW_ROW_COLLISIONS
}
