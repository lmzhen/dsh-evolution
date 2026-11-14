// @tier pre-tag
import { describe, expect, it } from 'vitest'
import { HOST_COMMAND_DEFS, renderHelpText, renderHint, summaryOf } from '../src/registry.ts'

describe('command registry (WD1, 0.3.55)', () => {
  it('renders the input-declaration hint and the help from ONE table', () => {
    expect(renderHint()).toBe(HOST_COMMAND_DEFS.map(entry => entry.usageLine).join(' | '))
    expect(renderHint()).toContain('doctor')
    expect(renderHelpText()).toContain('curator run|pause|resume|status|report|scope')
    expect(renderHelpText()).toContain('maintain [--timeout=<ms> | --facts]')
  })

  // G5 step 5 (audit F1/F2): the README-vs-renderer command-table pin was retired - the
  // authoritative judge is `verify-command-table.mjs`, and `renderCommandTable` has no other
  // consumer (the README table is produced on the generating side).
  it('T-WD2: every registry entry resolves a generated summary', () => {
    for (const entry of HOST_COMMAND_DEFS) {
      expect(summaryOf(entry).trim().length, `summary for ${entry.usageLine}`).toBeGreaterThan(0)
    }
  })
})
