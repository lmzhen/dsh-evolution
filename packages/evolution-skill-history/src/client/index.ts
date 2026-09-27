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
import { en, fill, NS, zh } from './messages.ts'
import { CSS, CSS_TAG_ID } from './styles.ts'
import { SkillHistoryPanel } from './Panel.ts'
import { PANEL_ID, type ClientSeam } from './seam.ts'

/** Required client services: the slot registry and the locale seat. */
export const inject = ['slots', 'locale']

/** Row order inside the global panel list (beside the platform's own rows). */
export const PANEL_ORDER = 35

/**
 * The row's icon: a platform-style line glyph, sized by the SIDEBAR's own contract.
 *
 * The platform hands every `sidebar.panellist` occupant `{ size, active }` (`SidebarRoot.tsx`
 * `renderSlot('sidebar.panellist', { size: wide ? 16 : 18, active }, …)`) and its own icons render at
 * that size (`IconGlobeOutline14 size={size}` in the sidebar's own spec). The neighbouring rows in a
 * shipped GUI take the OTHER route — they inject their entry into the sidebar's DOM with their own
 * `svg { width: 18px; height: 18px }` CSS — so 18px is the size a row glyph is expected to occupy.
 * A glyph that sizes itself from CSS (`width: 100%`) resolves against an unsized flex box and fills
 * the column: the size must come from the prop, with the neighbours' 18 as the fallback. The label
 * carries the accessible name, so the glyph stays decoration.
 */
function PanelIcon(props: { size?: number; active?: boolean } = {}): unknown {
  const size = typeof props.size === 'number' && props.size > 0 ? props.size : 18
  return createElement('svg', {
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
  createElement('circle', { cx: '8', cy: '8', r: '5.75' }),
  createElement('path', { d: 'M8 4.75V8l2.25 1.5' }),
  )
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
  // The panel's own stylesheet, injected once behind its tag. The bundle is built outside the
  // platform's CSS-Modules pipeline, so it carries the string itself (the family's settings section
  // does the same); the tag id keeps a hot reload from stacking copies.
  ctx.effect(() => {
    if (document.querySelector('style[data-plugin-css="' + CSS_TAG_ID + '"]') === null) {
      const tag = document.createElement('style')
      tag.setAttribute('data-plugin-css', CSS_TAG_ID)
      tag.textContent = CSS
      document.head.append(tag)
      return () => { tag.remove() }
    }
    return () => {}
  }, 'evolution-skill-history: styles')
  // A thunk, not a string: the sidebar re-reads the label on every projection, so a locale switch
  // follows without re-registering the row.
  seam.slots.inject('sidebar.panellist', function* () {
    yield seam.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: () => t('entry.label') },
      PanelIcon,
    )
    yield seam.slots.register(
      { name: 'main', key: PANEL_ID, inject: () => ({
        t,
        // The seat resolves the key; the dictionary owns the sentence and its slots.
        format: (key: string, values: Record<string, string | number>) => fill(t(key), values),
        loadSkills: api.skills,
        loadVersions: api.versions,
        loadDiff: api.diff,
        undo: api.undo,
      }) },
      SkillHistoryPanel,
    )
  })
}
