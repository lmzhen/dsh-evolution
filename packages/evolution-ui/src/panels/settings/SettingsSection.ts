/**
 * The section shell: title, one-line explanation, then one card per namespace — with the staged-write
 * window's card ahead of them all, because it is the only card here that waits on a decision.
 *
 * This is the shape the platform's own settings sections use — a heading plus the
 * child slots it declared in its registration. The cards themselves are separate
 * registrations keyed by namespace, so a namespace the Host does not serve simply
 * renders nothing and a deployment that drops this row loses the whole section.
 * @module @deepseek-ai/dsh-evolution-ui/panels/settings/client
 */
import { createElement, type ReactNode } from 'react'
import { FAMILY_VERSION } from './generated-about.ts'
import { CARD_SLOT, DIAGNOSTICS_CARD_KEY, type SectionFace } from './seam.ts'

/**
 * Render the section.
 * @param face - the shell's inject face: translator and child-slot renderer.
 * @returns the section element.
 */
export function SettingsSection(face: SectionFace): ReactNode {
  return createElement(
    'div',
    { className: 'evolution-params' },
    createElement('h2', { className: 'evolution-params-title' }, face.t('title')),
    createElement('p', { className: 'evolution-params-subtitle' }, face.t('subtitle')),
    createElement('p', { className: 'evolution-params-about' }, FAMILY_VERSION + ' · ' + face.t('aboutPurpose')),
    // G5.10/U-10: the decision line — which family version this surface belongs to and what it is for.
    // Both values are GENERATED (gen-about.mjs) from the files that own them; the browser half carries
    // constants because it cannot read a package.json and cannot import core (build-client.mjs keeps
    // every @deepseek-ai/* specifier external).
    // G5/W7 S7: the diagnostics card (read-only; same view the CLI prints) sits after the staged-write
    // window and before the parameter cards.
    createElement(
      'div',
      { key: DIAGNOSTICS_CARD_KEY, className: 'evolution-params-group' },
      face.renderSlot(CARD_SLOT, {}, { entryKey: DIAGNOSTICS_CARD_KEY }),
    ),
  )
}
