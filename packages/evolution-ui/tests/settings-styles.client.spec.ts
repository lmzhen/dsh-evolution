// @tier fast
// @vitest-environment jsdom
/**
 * The stylesheet's two structural invariants (T5-02/A57, T5-03/A58).
 *
 * Both were invisible to CI because this package had no style assertions at all: one selector carried
 * two different rules (so whichever came last won every shared property), and the family scale was
 * declared only on the section root (so the SAME card rendered unstyled on the Plugins page).
 */
import { describe, expect, it } from 'vitest'
import { CSS, CSS_TAG_ID, injectStyles } from '../src/panels/settings/styles.ts'
import { TOKEN_CSS } from '@lmzhen/dsh-evolution-client-kit/tokens'

describe('the settings stylesheet', () => {
  it('T5-02/A57: every selector appears ONCE — one class never carries two rules', () => {
    const seen = new Map<string, number>()
    for (const line of CSS.split('\n')) {
      const brace = line.indexOf('{')
      if (brace < 0) continue
      const selector = line.slice(0, brace).trim()
      seen.set(selector, (seen.get(selector) ?? 0) + 1)
    }
    // `.evolution-param-source` used to be both the row chip and the diff block: the later rule won
    // padding/border/overflow (the 20px chip grew a 12/16px padding) and the chip's inline-flex made
    // every diff line a flex item (the whole diff rendered as one row).
    const duplicated = [...seen.entries()].filter(([, count]) => count > 1).map(([selector]) => selector)
    expect(duplicated).toEqual([])
  })

  it('T5-02/A57: the diff block and the chip are two names', () => {
    expect(CSS).toContain('.evolution-param-diff{')
    expect(CSS).toContain('.evolution-param-source{display:inline-flex')
  })

  it('T5-03/A58: the scale travels with the CARD root, not only with the section root', () => {
    // The Plugins page renders the same card inside its own detail section, never under
    // `.evolution-params` (RowConfigCard hands ParamCardView straight to the page).
    const tokenRule = CSS.split('\n').find(line => line.includes(TOKEN_CSS.slice(0, 40)))
    expect(tokenRule).toBeDefined()
    expect(tokenRule).toContain('.evolution-param-card')
    expect(tokenRule).toContain('.evolution-params')
  })
})

it('P2-29: a new owner replaces the tag so the old disposer cannot unstyle it', () => {
  document.head.innerHTML = ''
  const old = document.createElement('style')
  old.setAttribute('data-plugin-css', CSS_TAG_ID)
  document.head.appendChild(old)
  const dispose = injectStyles(document as never)
  const tags = document.querySelectorAll('style[data-plugin-css="' + CSS_TAG_ID + '"]')
  expect(tags).toHaveLength(1)
  expect(tags[0]).not.toBe(old)
  old.remove()
  expect(document.querySelectorAll('style[data-plugin-css="' + CSS_TAG_ID + '"]')).toHaveLength(1)
  dispose()
  expect(document.querySelectorAll('style[data-plugin-css="' + CSS_TAG_ID + '"]')).toHaveLength(0)
})

it('keeps the params footer visible and centers the pending empty state', () => {
  expect(CSS).toContain('.evolution-param-card[data-card="params"] .evolution-param-body')
  expect(CSS).toContain('.evolution-param-card[data-card="params"] .evolution-param-footer{position:sticky')
  expect(CSS).toContain('.evo-pending-empty{')
})
