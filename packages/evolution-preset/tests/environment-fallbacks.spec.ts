import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// S7.3 / E-74: the `session-query-sqlite` override used
// `!!js process.env.DSH_EVOLUTION_SESSION_QUERY ?? 'startup'`. `??` (nullish
// coalescing) only falls back on `null`/`undefined`, so a set-but-EMPTY
// variable (`SET DSH_EVOLUTION_SESSION_QUERY=`) was treated as a real value and
// disabled the startup index instead of defaulting to 'startup'. The release
// fix used `||` so every falsy value fell back.
//
// P2-13 (V10-15) goes one step further: ANY value outside the platform schema
// union (`startup` | `first-search` | `never`) used to reach the z.union
// validator and blow up the whole profile at startup, with the error far from
// the root cause. The patch now whitelist-normalizes inside the `!!js`
// expression: unknown/empty values fall back to 'startup'. The mirrored
// helpers below replicate the patched expressions (aside from the
// `process.env` access) so the behavior is pinned without importing a runtime
// that would need the real `process.env`.
const openAtFallback = (value: string | undefined): string =>
  ['startup', 'first-search', 'never'].includes(value ?? '') ? (value as string) : 'startup'

// P2-12 (V10-15): `??` on DSH_EVOLUTION_SESSION_QUERY_PATH only caught
// null/undefined — a set-but-EMPTY variable survived and `resolve('')` dropped
// the SQLite index into the process CWD. The patch trims first and only a
// non-empty value overrides the durable default. The second operand mirrors
// `dshHomePath('evolution', 'session-query.db')` as a constant sentinel.
const PATH_SENTINEL = 'dshHomePath:evolution:session-query.db'
const pathFallback = (value: string | undefined): string =>
  (value || '').trim() || PATH_SENTINEL

function loadPatchText(): string {
  return readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')
}

describe('session-query-sqlite openAt env fallback (S7.3, E-74, V10-15)', () => {
  it('normalizes openAt through the startup/first-search/never whitelist', () => {
    const patch = loadPatchText()
    expect(patch).toContain(
      "!!js \"['startup', 'first-search', 'never'].includes(process.env.DSH_EVOLUTION_SESSION_QUERY) ? process.env.DSH_EVOLUTION_SESSION_QUERY : 'startup'\"",
    )
    // The old forms are gone in BOTH bundle patches (host and preset must stay
    // byte-identical on this shared row, E-33).
    expect(patch).not.toContain("DSH_EVOLUTION_SESSION_QUERY ?? 'startup'")
    expect(patch).not.toContain("DSH_EVOLUTION_SESSION_QUERY || 'startup'")
  })

  it('an empty, whitespace or invalid value falls back to startup; modes are preserved', () => {
    // `SET DSH_EVOLUTION_SESSION_QUERY=` produces an empty string; a typo like
    // `=1` used to be a profile-wide startup failure (P2-13).
    expect(openAtFallback('')).toBe('startup')
    expect(openAtFallback('1')).toBe('startup')
    expect(openAtFallback('always')).toBe('startup')
    expect(openAtFallback(undefined)).toBe('startup')
    expect(openAtFallback('never')).toBe('never')
    expect(openAtFallback('first-search')).toBe('first-search')
  })
})

describe('session-query-sqlite path env fallback (P2-12, V10-15)', () => {
  it('trims DSH_EVOLUTION_SESSION_QUERY_PATH before trusting it', () => {
    const patch = loadPatchText()
    expect(patch).toContain("(process.env.DSH_EVOLUTION_SESSION_QUERY_PATH || '').trim() || dshHomePath('evolution', 'session-query.db')")
    expect(patch).not.toContain('DSH_EVOLUTION_SESSION_QUERY_PATH ??')
  })

  it('an empty or whitespace-only path falls back to the durable default', () => {
    expect(pathFallback('')).toBe(PATH_SENTINEL)
    expect(pathFallback('   ')).toBe(PATH_SENTINEL)
    expect(pathFallback(undefined)).toBe(PATH_SENTINEL)
    expect(pathFallback('/tmp/queries.db')).toBe('/tmp/queries.db')
    expect(pathFallback('  queries.db ')).toBe('queries.db')
  })
})
