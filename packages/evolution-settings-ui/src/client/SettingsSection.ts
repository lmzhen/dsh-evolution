/**
 * The section shell: title, one-line explanation, then one card per namespace.
 *
 * This is the shape the platform's own settings sections use — a heading plus the
 * child slots it declared in its registration. The cards themselves are separate
 * registrations keyed by namespace, so a namespace the Host does not serve simply
 * renders nothing and a deployment that drops this row loses the whole section.
 * @module @deepseek-ai/dsh-evolution-settings-ui/client
 */
import { createElement, type ReactNode } from 'react'
import { CLIENT_PARAM_SECTIONS } from './generated-params.ts'
import { CARD_SLOT, type SectionFace } from './seam.ts'

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
    ...CLIENT_PARAM_SECTIONS.map(section_ =>
      createElement(
        'div',
        { key: section_.namespace, className: 'evolution-params-group' },
        face.renderSlot(CARD_SLOT, {}, { entryKey: section_.namespace }),
      )),
  )
}
