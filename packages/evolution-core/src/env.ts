/**
 * Evolution environment-variable reading, single-source (WC, 0.3.56).
 *
 * Every `DSH_EVOLUTION_*` value the PLUGIN code reads goes through this module
 * so the trim/whitelist patterns (v10 P2-12/13) live in exactly one place and
 * the generated env reference can point at one behavior. Configuration-layer
 * reads inside patch YAML `!!js` expressions (session-query path/openAt) stay
 * in the profile config evaluation — they are NOT migrated (they are resolved
 * at cordis config time, not plugin time) but are documented in the README
 * env table. `EVOLUTION_SCOPE` is read by the source installers only
 * (`packages/scripts/install-layered.mjs`, `packages/test-support/row-contract.ts`),
 * never by plugin runtime code.
 *
 * v14 P3-1: the former `EVOLUTION_ENV_KEYS` export was deleted — nothing read
 * it, so the "generated env reference" it claimed to source was never
 * generated (the README table is maintained by hand and now lists every key).
 */

const ALLOW_ROW_COLLISIONS = '1'

/** N-5 escape: `DSH_EVOLUTION_ALLOW_ROW_COLLISIONS=1` downgrades a delta-row
 * collision from fail-loud to warn+keep-both. Any other value (including an
 * EMPTY/whitespace string — a set-but-unset variable) keeps the fail-loud. */
export function allowRowCollisions(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DSH_EVOLUTION_ALLOW_ROW_COLLISIONS === ALLOW_ROW_COLLISIONS
}
