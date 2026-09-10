import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { COMMAND_ENTRIES, renderCommandTable, renderHelpText, renderHint } from '../src/registry.ts'

describe('command registry (WD1, 0.3.55)', () => {
  it('renders the input-declaration hint and the help from ONE table', () => {
    expect(renderHint()).toBe(COMMAND_ENTRIES.map(entry => entry.usage).join(' | '))
    expect(renderHint()).toContain('doctor')
    expect(renderHelpText()).toContain('curator run|pause|resume|status|report|scope')
    expect(renderHelpText()).toContain('maintain [--timeout=<ms> | --facts]')
  })

  it('T-WD2: the README command table matches the registry (single-source pin)', () => {
    const readme = readFileSync(fileURLToPath(new URL('../../README.md', import.meta.url)), 'utf8')
    // F2 (P2-17, v11): compare against the ACTUAL renderer — the table in the
    // README must be byte-identical to renderCommandTable() (the old test
    // inlined its own escape logic and never called the function, so a
    // renderer drift silently passed).
    // v21 (T-4): make the pin TWO-way. The old containment form
    // (rendered ⊆ README, arbitrary positions) passed with a stale leftover
    // command row still sitting in the README table. Locate the rendered
    // block in sequence and require: (a) every rendered line matches in
    // order, (b) no extra table row follows the block.
    const renderedLines = renderCommandTable().split('\n')
    const readmeLines = readme.split('\n')
    const start = readmeLines.findIndex(line => line === renderedLines[0])
    if (start === -1) {
      throw new Error(`README command table drifted: first rendered row not found:\n${renderedLines[0]}`)
    }
    expect(readmeLines.slice(start, start + renderedLines.length)).toEqual(renderedLines)
    const afterBlock = readmeLines[start + renderedLines.length]
    expect(afterBlock === undefined || !afterBlock.startsWith('|'),
      `README carries an extra command row after the rendered table: ${afterBlock}`).toBe(true)
  })

  it('T-WD2: every registry entry carries a non-empty summary', () => {
    for (const entry of COMMAND_ENTRIES) {
      expect(entry.summary.trim().length, `summary for ${entry.usage}`).toBeGreaterThan(0)
    }
  })
})
