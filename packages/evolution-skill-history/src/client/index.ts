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
 * The row's icon: a platform-style line glyph rather than an emoji.
 *
 * An emoji cannot follow `currentColor`, cannot match the 16/18px the sidebar hands its glyph slot,
 * and renders differently on every platform font — the sidebar's other rows are 1.5px-stroke line
 * icons, and this one now is too. The label carries the accessible name, so the glyph stays
 * decoration.
 */
function PanelIcon(): unknown {
  return createElement('svg', {
    'aria-hidden': 'true',
    width: '100%',
    height: '100%',
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
