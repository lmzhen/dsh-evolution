/**
 * Browser half: one left-sidebar panel row (`技能历史`) and the main-column body it opens.
 *
 * Two places, one id — the sidebar contract is that `sidebar.panellist` owns the button and the layout's
 * keyed `main` slot owns the body, dispatched by that same id. The row renders only while this
 * bundle is loaded: a deployment that drops the row loses the panel and nothing else, because every
 * fact it shows comes from the host routes on demand.
 * @module @deepseek-ai/dsh-evolution-skill-history/client
 */
import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSkillHistoryApi } from './api.ts'
import { en, NS, zh } from './messages.ts'
import { SkillHistoryPanel } from './Panel.ts'
import { PANEL_ID, type ClientSeam } from './seam.ts'

/** Required client services: the slot registry and the locale seat. */
export const inject = ['slots', 'locale']

/** Row order inside the global panel list (beside the platform's own rows). */
export const PANEL_ORDER = 35

/** The row's icon: the label carries the accessible name, so the glyph is decoration only. */
function PanelIcon(): unknown {
  return createElement('span', { 'aria-hidden': 'true' }, '🕘')
}

/**
 * Register the locale namespace, the panel row and the panel body.
 * @param ctx - the client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const seam = ctx as unknown as ClientSeam
  const api = createSkillHistoryApi()
  // The dictionary registration is an EFFECT, not a bare call: cordis disposes it when this bundle
  // unloads (a hot reload, or the row being switched off), which is the shape the platform's own
  // client plugins use. A seat that refuses the registration leaves the panel on the fallback copy.
  ctx.effect(() => {
    const dispose = seam.locale.register(NS, { zh, en })
    return dispose
  }, 'evolution-skill-history: locale')
  const t = seam.locale.bind(NS)
  // A thunk, not a string: the sidebar re-reads the label on every projection, so a locale switch
  // follows without re-registering the row.
  seam.slots.inject('sidebar.panellist', function* () {
    yield seam.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: () => t('entry.label') },
      PanelIcon,
    )
    yield seam.slots.register(
      { name: 'main', key: PANEL_ID, inject: () => ({ t, loadSkills: api.skills, loadVersions: api.versions, undo: api.undo }) },
      SkillHistoryPanel,
    )
  })
}
