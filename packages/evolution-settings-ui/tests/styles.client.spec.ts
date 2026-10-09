// @vitest-environment jsdom
/**
 * The stylesheet's two structural invariants (T5-02/A57, T5-03/A58).
 *
 * Both were invisible to CI because this package had no style assertions at all: one selector carried
 * two different rules (so whichever came last won every shared property), and the family scale was
 * declared only on the section root (so the SAME card rendered unstyled on the Plugins page).
 */
import { describe, expect, it } from 'vitest'
import { CSS } from '../src/client/styles.ts'
import { TOKEN_CSS } from '../src/client/tokens.ts'

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
