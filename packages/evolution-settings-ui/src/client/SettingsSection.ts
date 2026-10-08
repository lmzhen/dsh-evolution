/**
 * The section shell: title, one-line explanation, then one card per namespace — with the staged-write
 * window's card ahead of them all, because it is the only card here that waits on a decision.
 *
 * This is the shape the platform's own settings sections use — a heading plus the
 * child slots it declared in its registration. The cards themselves are separate
 * registrations keyed by namespace, so a namespace the Host does not serve simply
 * renders nothing and a deployment that drops this row loses the whole section.
 * @module @deepseek-ai/dsh-evolution-settings-ui/client
 */
import { createElement, type ReactNode } from 'react'
import { CLIENT_PARAM_SECTIONS } from './generated-params.ts'
import { CARD_SLOT, PENDING_CARD_KEY, type SectionFace } from './seam.ts'

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
    // The staged-write window is not a setting, so it is not one of CLIENT_PARAM_SECTIONS — but it rides
    // this same keyed slot, and a keyed slot renders ONLY the keys a section asks for: registering it is
    // not enough (0.16.0 shipped exactly that bug — the card had no `renderSlot` naming its key, so it
    // never appeared). It comes FIRST because it is the one card here that waits on a decision.
    createElement(
      'div',
      { key: PENDING_CARD_KEY, className: 'evolution-params-group' },
      face.renderSlot(CARD_SLOT, {}, { entryKey: PENDING_CARD_KEY }),
    ),
    ...CLIENT_PARAM_SECTIONS.map(section_ =>
      createElement(
        'div',
        { key: section_.namespace, className: 'evolution-params-group' },
        face.renderSlot(CARD_SLOT, {}, { entryKey: section_.namespace }),
      )),
  )
}
