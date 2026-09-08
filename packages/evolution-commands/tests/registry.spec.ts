import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { COMMAND_ENTRIES, renderHelpText, renderHint } from '../src/registry.ts'

describe('command registry (WD1, 0.3.55)', () => {
  it('renders the input-declaration hint and the help from ONE table', () => {
    expect(renderHint()).toBe(COMMAND_ENTRIES.map(entry => entry.usage).join(' | '))
    expect(renderHint()).toContain('doctor')
    expect(renderHelpText()).toContain('curator run|pause|resume|status|report|scope')
    expect(renderHelpText()).toContain('maintain [--timeout=<ms> | --facts]')
  })

  it('T-WD2: the README command table matches the registry (single-source pin)', () => {
    const readme = readFileSync(fileURLToPath(new URL('../../README.md', import.meta.url)), 'utf8')
    for (const entry of COMMAND_ENTRIES) {
      const cell = entry.usage.replace(/\|/g, '\\|')
      // Same escape as renderCommandTable — a drifted row fails here.
      expect(readme, `README must document /evolution ${entry.usage}`).toContain(`/evolution ${cell}`)
    }
  })

  it('T-WD2: every registry entry carries a non-empty summary', () => {
    for (const entry of COMMAND_ENTRIES) {
      expect(entry.summary.trim().length, `summary for ${entry.usage}`).toBeGreaterThan(0)
    }
  })
})
