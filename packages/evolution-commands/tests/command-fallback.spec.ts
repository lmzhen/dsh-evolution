// @tier fast
/**
 * G6/W8: COMMAND_FALLBACKS is the ONE home of the command-face pairs. Its key set is pinned to the
 * four Host surfaces (the same set HOST_ROUTES declares), so a new surface cannot ship without a
 * command-face answer, and every hint names a family command.
 */
import { describe, expect, it } from 'vitest'
import { HOST_ROUTES } from '@deepseek-ai/dsh-evolution-core/http-routes'
import { COMMAND_FALLBACKS, COMMAND_FALLBACK_SURFACES } from '../src/command-fallback.ts'

const HOST_SURFACE_IDS: Readonly<Record<string, string>> = {
  approval: 'approval',
  skillHistory: 'skill-history',
  skillHealth: 'skill-health',
  diagnostics: 'diagnostics',
}

describe('COMMAND_FALLBACKS', () => {
  it('covers exactly the four HOST_ROUTES surfaces', () => {
    const hostSurfaces = Object.keys(HOST_ROUTES).map(key => HOST_SURFACE_IDS[key]).sort()
    expect([...COMMAND_FALLBACK_SURFACES].sort()).toEqual(hostSurfaces)
    expect(Object.keys(COMMAND_FALLBACKS).sort()).toEqual(hostSurfaces)
  })

  it('gives every surface a runnable /evolution command', () => {
    for (const surface of COMMAND_FALLBACK_SURFACES) {
      expect(COMMAND_FALLBACKS[surface].command, surface).toContain('/evolution')
    }
    expect(COMMAND_FALLBACKS.diagnostics.platformCli ?? '').toContain('doctor')
  })
})
