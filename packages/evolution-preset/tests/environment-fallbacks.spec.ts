import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// S7.3 / E-74: the `session-query-sqlite` override used
// `!!js process.env.DSH_EVOLUTION_SESSION_QUERY ?? 'startup'`. `??` (nullish
// coalescing) only falls back on `null`/`undefined`, so a set-but-EMPTY
// variable (`SET DSH_EVOLUTION_SESSION_QUERY=`) was treated as a real value and
// disabled the startup index instead of defaulting to 'startup'. The release
// fix uses `||` so every falsy value — including the empty string — falls back.
// This spec asserts the patch carries that form and that the expression behaves
// accordingly. `openAtFallback` mirrors the patched expression byte-for-byte
// (aside from the `process.env` access) so the behavior is pinned without
// importing a runtime that would need the real `process.env`.
const openAtFallback = (value: string | undefined): string => value || 'startup'

function loadPatchText(): string {
  return readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')
}

describe('session-query-sqlite openAt env fallback (S7.3, E-74)', () => {
  it('reads openAt via `||` so an empty env still falls back to startup', () => {
    const patch = loadPatchText()
    expect(patch).toContain("process.env.DSH_EVOLUTION_SESSION_QUERY || 'startup'")
    expect(patch).not.toContain("process.env.DSH_EVOLUTION_SESSION_QUERY ?? 'startup'")
  })

  it('uses the shared dshHomePath helper instead of a hardcoded home path', () => {
    const patch = loadPatchText()
    expect(patch).toContain("dshHomePath('evolution', 'session-query.db')")
    expect(patch).not.toContain('USERPROFILE')
  })

  it('an empty string falls back to startup while explicit modes are preserved', () => {
    // `SET DSH_EVOLUTION_SESSION_QUERY=` produces an empty string.
    expect(openAtFallback('')).toBe('startup')
    expect(openAtFallback(undefined)).toBe('startup')
    expect(openAtFallback('never')).toBe('never')
    expect(openAtFallback('first-search')).toBe('first-search')
  })
})
