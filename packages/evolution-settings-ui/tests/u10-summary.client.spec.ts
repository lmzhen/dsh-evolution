// @tier fast
// @vitest-environment jsdom
/**
 * G5.10 / U-10: the section states its DECISION LINE — which family version this surface belongs to
 * and what it is for.
 *
 * The judge is assertable rather than visual: both values come from the GENERATED module
 * (`generated-about.ts`, written by `gen-about.mjs` from the repository `package.json` and this
 * package's own `description`), so this spec fails when the row disappears AND when someone swaps the
 * constants for hand-written text.
 *
 * Rendered through the section's real face: an invented prop shape would render an empty element and
 * every query would pass vacuously (the same trap the card specs call out).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { FAMILY_VERSION, PACKAGE_PURPOSE } from '../src/client/generated-about.ts'
import { SettingsSection } from '../src/client/SettingsSection.ts'

/** `createElement` narrowed for the renderer (the package carries its own minimal ambient React surface). */
const h = createElement as unknown as (type: unknown, props: unknown) => Parameters<typeof render>[0]

/** The section's inject face, reduced to what the component reads. */
const face = {
  t: (key: string): string => key,
  renderSlot: (): null => null,
}

afterEach(() => { cleanup() })

describe('the section decision line (U-10)', () => {
  it('renders the generated version together with the generated purpose', () => {
    render(h(SettingsSection, face))
    const about = screen.getByText(new RegExp(FAMILY_VERSION.split('.').join('\\.')))
    expect(about.textContent).toContain(FAMILY_VERSION)
    expect(about.textContent).toContain(PACKAGE_PURPOSE)
  })
})
