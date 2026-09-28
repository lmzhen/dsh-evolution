// @vitest-environment jsdom
/**
 * The reading face, RENDERED (G4).
 *
 * Four findings were about reading a version as a document: it was wrapped like a quotation card
 * (W21), read through a 420px window with its own scrollbar (W20), had no line-width limit (W18), and
 * a truncated body said only that something was missing (W23) — while the frontmatter block was
 * rendered as the document's biggest heading (W19). The stylesheet assertions are string checks
 * because jsdom returns `var()` unresolved; the DOM assertions are about which text a reader gets.
 *
 * This spec was claimed by the G4 commit message and did NOT exist until the post-release audit: the
 * batch that created it aborted on an unrelated edit error before the write ran, and the commit message
 * was written from the plan instead of from the tree. The gap is recorded in the design document's
 * §18.11 — a rendered face without a rendered spec is exactly what the family's client lane exists for.
 */
import { describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { DiffBody, PreviewBody, type DocumentFace } from '../src/client/document.ts'
import { CSS } from '../src/client/styles.ts'

const face: DocumentFace = {
  t: key => key,
  format: (key, values) => key + '(' + Object.values(values).join(',') + ')',
  markdownWords: { copy: 'copy', copied: 'copied', footnotes: 'footnotes' },
}

/** One diff the renderer cannot reach, so the source view is what gets drawn. */
const diff = { v: 2, against: 1, linesAdded: 2, linesRemoved: 1, truncated: false, hunks: [{ path: 'SKILL.md', oldText: 'old', newText: 'new' }] }

/** The declarations of one rule of the injected stylesheet. */
function rule(selector: string): string {
  const found = CSS.split('\n').find(line => line.startsWith(selector + '{'))
  return found ?? ''
}

describe('the reading face is a document, not a card of controls (G4)', () => {
  it('gives the document a measure and lets the PANE scroll it (W18/W20)', () => {
    const preview = rule('.evo-doc-preview')
    expect(preview).toContain('max-width:var(--evo-measure-read)')
    // No inner window: the scrollbar a reader meets is the pane's own.
    expect(preview).not.toContain('max-height')
    expect(preview).not.toContain('overflow')
  })

  it('does not wrap the document in a surface of its own (W21)', () => {
    const preview = rule('.evo-doc-preview')
    expect(preview).not.toContain('border')
    expect(preview).not.toContain('background')
    // ...while the SOURCE view stays the platform's code surface, which is a card on purpose: it is
    // the one place exact bytes are shown, and a diff is not prose.
    const source = rule('.evo-doc-source')
    expect(source).toContain('max-height:var(--evo-cap-block)')
    expect(source).toContain('overflow:auto')
  })

  it('says how much of a bounded body it is not showing (W23)', () => {
    const view = render(createElement(PreviewBody, {
      face,
      body: { kind: 'ready', body: { v: 1, display: 'abc', chars: 5000, truncated: true } },
    }))
    const sentence = view.container.querySelector('.evo-hist-note')?.textContent ?? ''
    expect(sentence).toContain('3')
    expect(sentence).toContain('5000')
    cleanup()
  })

  it('renders the text a reader sees, not the stored bytes (W19)', () => {
    const view = render(createElement(PreviewBody, {
      face,
      body: { kind: 'ready', body: { v: 1, display: '# Alpha\n\nBody text.', chars: 30, truncated: false } },
    }))
    const text = view.container.textContent ?? ''
    expect(text).toContain('# Alpha')
    expect(text).toContain('Body text.')
    // The host already stripped the block; a document face that showed it would put it back.
    expect(text).not.toContain('---')
    cleanup()
  })

  it('degrades to the exact text when the platform renderer is out', () => {
    const view = render(createElement(PreviewBody, {
      face,
      body: { kind: 'ready', body: { v: 1, display: '# Alpha', chars: 7, truncated: false } },
    }))
    expect(view.container.querySelector('pre.evo-doc-source')?.textContent).toBe('# Alpha')
    cleanup()
  })

  it('offers the source/rendered choice as a choice, not as an expansion (W14)', () => {
    const view = render(createElement(DiffBody, { face, diff: { kind: 'ready', diff } }))
    const switches = [...view.container.querySelectorAll('button[data-kind="switch"]')]
    expect(switches.map(node => node.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
    // The renderer is absent in this lane, so the diff falls back to the exact bytes.
    expect(view.container.querySelector('pre.evo-doc-source')).not.toBeNull()
    cleanup()
  })

  it('separates the facts of a diff header in the stylesheet, not in the component (W15)', () => {
    const view = render(createElement(DiffBody, { face, diff: { kind: 'ready', diff } }))
    const text = view.container.querySelector('.evo-hist-note')?.textContent ?? ''
    // The separator is a `::before`, so it never reaches the DOM text: a component that concatenated
    // it would leave the character here.
    expect(text).not.toContain('·')
    expect(view.container.querySelectorAll('.evo-doc-fact')).toHaveLength(3)
    expect(rule('.evo-doc-fact+.evo-doc-fact::before')).toContain('content:"·"')
    cleanup()
  })
})
