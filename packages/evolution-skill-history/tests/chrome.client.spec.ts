// @vitest-environment jsdom
/**
 * The tool face's vocabulary, RENDERED (G3).
 *
 * Four findings of the interface review were about what a reader can and cannot see, and none of them
 * is visible to `tsc` or to a core test: the row's decision facts must sit in a slot the browser's
 * ellipsis cannot eat (W1), a control that acts must look different from one that only reveals more
 * (W14), a refusal must not be carried by colour alone (W13), and a state chip must not borrow the
 * interaction colour (W9). The stylesheet assertions are string checks on the injected CSS: the
 * platform's own client packages are the precedent for carrying CSS as a string, and jsdom returns
 * `var()` unresolved, so the scale-membership judgements belong on the string.
 */
import { describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { skillRowCells, versionRowCells } from '@deepseek-ai/dsh-evolution-core'
import { note } from '../src/client/atoms.ts'
import { skillLine, versionRow, type Copy } from '../src/client/chrome.ts'
import { CSS } from '../src/client/styles.ts'
import type { SkillRow, VersionRow } from '../src/client/api.ts'

/** The seat as the slot renderer hands it over: keys as words, so assertions name the exact copy. */
const copy: Copy = {
  t: key => key,
  format: (key, values) => key + '(' + Object.values(values).join(',') + ')',
}

const skill = (over: Partial<SkillRow> = {}): SkillRow => {
  const facts = {
    name: 'alpha', versions: 2, description: 'a description that is long enough to be clipped by the layout',
    managed: true, protectedBy: null, protectionUnknown: false, age: { unit: 'hours', n: 4 },
  }
  return { ...facts, lastAt: 'T2', cells: skillRowCells(facts), ...over }
}

const version = (over: Partial<VersionRow> = {}): VersionRow => {
  const facts = { v: 3, actionKind: 'update', age: { unit: 'hours', n: 4 } }
  return {
    ...facts, at: '2026-09-28T10:00:00Z', action: 'update', hash: 'h3', chars: 10, undoable: true,
    cells: versionRowCells(facts), ...over,
  }
}

/** The declarations of one rule of the injected stylesheet. */
function rule(selector: string): string {
  const found = CSS.split('\n').find(line => line.startsWith(selector + '{'))
  return found ?? ''
}

describe('the tool face says what it is (G3)', () => {
  it('keeps the decision facts out of the slot the ellipsis can eat (W1)', () => {
    const view = render(createElement('div', null, skillLine(copy, skill(), false, () => {})))
    const aside = [...view.container.querySelectorAll('.evo-hist-slot-aside')].map(node => node.textContent)
    // The size and the last-changed age are the two facts a reader decides on, and both are `aside`.
    expect(aside).toEqual(['versions.count(2)', 'time.hours(4)'])
    const description = view.container.querySelector('.evo-hist-cell-meta .evo-hist-slot-lead')
    // The renderer never truncates in JavaScript: the layout's ellipsis does, at the real width.
    expect(description?.textContent).toBe(skill().description)
    expect(description?.textContent).not.toContain('…')
    cleanup()
  })

  it('tells a control that acts from one that only reveals more (W14)', () => {
    const view = render(createElement('div', null, versionRow({
      copy, row: version(), confirming: false, open: undefined, expanded: null,
      onRestore: () => {}, onCancel: () => {}, onToggle: () => {},
    })))
    const kinds = [...view.container.querySelectorAll('button')].map(node => node.getAttribute('data-kind'))
    expect(kinds).toEqual(['action', 'toggle', 'toggle'])
    // A toggle shows its state with a drawn glyph, and it is never the primary tone.
    const toggles = [...view.container.querySelectorAll('button[data-kind="toggle"]')]
    expect(toggles.every(node => node.querySelector('svg') !== null)).toBe(true)
    expect(toggles.every(node => node.getAttribute('data-tone') === 'quiet')).toBe(true)
    cleanup()
  })

  it('marks the click that writes, and only while it is pending (W14)', () => {
    const pending = render(createElement('div', null, versionRow({
      copy, row: version(), confirming: true, open: 'diff', expanded: null,
      onRestore: () => {}, onCancel: () => {}, onToggle: () => {},
    })))
    const primary = pending.container.querySelectorAll('button[data-tone="primary"]')
    expect(primary).toHaveLength(1)
    expect(primary[0]?.textContent).toContain('undo.confirm')
    cleanup()
  })

  it('carries a refusal with a surface and a glyph, not with colour alone (W13)', () => {
    const view = render(createElement('div', null, note({ error: true, children: 'boom' })))
    const node = view.container.querySelector('.evo-hist-note')
    expect(node?.getAttribute('data-error')).toBe('true')
    expect(node?.querySelector('svg')).not.toBeNull()
    expect(rule('.evo-hist-note[data-error="true"]')).toContain('border:var(--evo-hairline-width) solid var(--evo-tone-danger)')
    cleanup()
  })

  it('gives a state chip the neutral layer, never the interaction colour (W9)', () => {
    const chip = rule('.evo-hist-chip')
    expect(chip).toContain('background:var(--dsw-alias-bg-layer-2)')
    expect(chip).not.toContain('interactive-bg')
  })

  it('starts an empty list where a row starts (W16)', () => {
    const empty = rule('.evo-hist-empty')
    const row = rule('.evo-hist-skill')
    const padding = (declaration: string): string => (declaration.match(/padding:[^;]*/) ?? [''])[0]
    expect(padding(empty)).toBe(padding(row))
  })

  it('caps a row so its controls stay within reach of the text they act on (W4)', () => {
    expect(rule('.evo-hist-row')).toContain('max-width:calc(var(--evo-measure-read) * 1.5)')
  })

  it('defines the focus ring once and never as a literal (W8)', () => {
    const rings = CSS.split('\n').filter(line => line.includes('outline:var(--evo-focus-ring)'))
    expect(rings.length).toBeGreaterThanOrEqual(3)
    expect(CSS).not.toContain('outline:2px')
    expect(CSS).not.toContain('outline:none')
  })
})
