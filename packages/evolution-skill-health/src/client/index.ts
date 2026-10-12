/**
 * Browser half: one left-sidebar row (`技能健康`) and the main-column body it opens.
 *
 * Two places, one id: `sidebar.panellist` owns the row and the layout's keyed `main` slot owns the
 * body, dispatched by that same id. Facts arrive through a loader the HOST half supplies, so this
 * bundle keeps no state of its own and touches no service.
 * @module @deepseek-ai/dsh-evolution-skill-health/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement } from 'react'
import { PANEL_ID, PANEL_ORDER, type ClientSeam } from './seam.ts'
import { NS } from './messages.ts'
import { SkillHealthPanel, type HealthFace } from './Panel.ts'

/** Required client services: the slot registry and the locale seat. */
export const inject = ['slots', 'locale']

/** The host half hands the panel a way to read its rows (a read-only route on the host side). */
export type HealthFaceLoader = () => Promise<HealthFace>

/**
 * Register the row and the body.
 * @param ctx - the client context; it must carry the two seats above.
 */
export function apply(ctx: ClientContext): void {
  const seam = ctx as unknown as ClientSeam
  const label = (): string => seam.locale.bind(NS)('entry.label')
  seam.slots.inject('sidebar.panellist', function* () {
    yield seam.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label },
      () => createElement('span', null, label()),
    )
    yield seam.slots.register(
      { name: 'main', key: PANEL_ID, inject: (): HealthFace => ({ rows: [], truncated: false }) },
      (props: unknown) => createElement(SkillHealthPanel, { face: (props as { face: HealthFace }).face, locale: seam.locale }),
    )
  })
}
