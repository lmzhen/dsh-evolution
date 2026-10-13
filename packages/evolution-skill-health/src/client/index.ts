/**
 * Browser half: one left-sidebar row (`技能健康`) and the main-column body it opens.
 *
 * Two places, one id: `sidebar.panellist` owns the row and the layout's keyed `main` slot owns the
 * body, dispatched by that same id. Facts arrive through a loader the HOST half supplies, so this
 * bundle keeps no state of its own and touches no service.
 * @module @deepseek-ai/dsh-evolution-skill-health/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement, type ReactElement } from 'react'
import { PANEL_ID, PANEL_ORDER, type ClientSeam } from './seam.ts'
import { NS, en, zh } from './messages.ts'
import { SkillHealthPanel, type HealthFace } from './Panel.ts'
import { CSS, CSS_TAG_ID } from './styles.ts'

/** Required client services: the slot registry and the locale seat. */
export const inject = ['slots', 'locale']

/** The host half hands the panel a way to read its rows (a read-only route on the host side). */
export type HealthFaceLoader = () => Promise<HealthFace>

/**
 * Register the row and the body.
 * @param ctx - the client context; it must carry the two seats above.
 */
/**
 * The row glyph. The sidebar hands every `sidebar.panellist` occupant `{ size, active }` and owns the
 * slot around it, so this is a plain line glyph drawn in `currentColor`.
 * @param props - the seat-provided size and active flag.
 * @returns the glyph element.
 */
function PanelIcon(props: { size?: number; active?: boolean } = {}): ReactElement {
  const size = typeof props.size === 'number' && props.size > 0 ? props.size : 16
  return createElement(
    'svg',
    {
      'aria-hidden': 'true',
      width: String(size),
      height: String(size),
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '1.5',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
    createElement('path', { d: 'M2 8h3l1.5-3.5L9 11.5 10.5 8H14' }),
  )
}
export function apply(ctx: ClientContext): void {
  const seam = ctx as unknown as ClientSeam
  // The dictionary registration is an effect AND is guarded: the seat throws when this namespace is
  // already registered (a second bundle, or a hot reload whose dispose has not run yet), and an
  // uncaught throw here aborts apply(), so the row and body registrations below never run and the
  // panel disappears without a message. The sibling half carries the same guard for the same reason.
  let registered: boolean = false
  ctx.effect(() => {
    try {
      const dispose = seam.locale.register(NS, { zh, en })
      registered = true
      return dispose
    } catch (error) {
      ctx.logger.warn(
        `evolution-skill-health: the locale seat refused the "${NS}" dictionary (${String(error)});`
          + ' the row falls back to the bundle copy.',
      )
      return () => {}
    }
  }, 'evolution-skill-health: locale')
  // The panel stylesheet, injected once behind its tag id (see styles.ts).
  ctx.effect(() => {
    if (document.querySelector('style[data-plugin-css="' + CSS_TAG_ID + '"]') === null) {
      const tag = document.createElement('style')
      tag.setAttribute('data-plugin-css', CSS_TAG_ID)
      tag.textContent = CSS
      document.head.append(tag)
      return () => { tag.remove() }
    }
    return () => {}
  }, 'evolution-skill-health: styles')
  const label = (): string => {
    const fallback = zh['entry.label'] ?? '技能健康'
    if (!registered) return fallback
    try { return seam.locale.bind(NS)('entry.label') } catch { return fallback }
  }
  seam.slots.inject('sidebar.panellist', function* () {
    yield seam.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label },
      PanelIcon,
    )
    yield seam.slots.register(
      { name: 'main', key: PANEL_ID, inject: (): HealthFace => ({ rows: [], truncated: false }) },
      (props: unknown) => createElement(SkillHealthPanel, { face: (props as { face: HealthFace }).face, locale: seam.locale }),
    )
  })
}
