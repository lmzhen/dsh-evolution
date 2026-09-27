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
 * The row's icon: a platform-style line glyph, whose SIZE comes from the sidebar's contract and whose
 * glyph BOX is the one the neighbouring rows draw at.
 *
 * Size: the platform hands every `sidebar.panellist` occupant `{ size, active }` (`SidebarRoot.tsx`
 * `renderSlot('sidebar.panellist', { size: wide ? 16 : 18, active }, …)`), so the glyph takes its size
 * from that prop; a glyph that sizes itself from CSS (`width: 100%`) resolves against an unsized flex
 * box and fills the whole column.
 *
 * Box: the three rows above (task board / SSH / skill centre) are NOT slot occupants — they inject
 * plain DOM into the sidebar with their own CSS (`.entry{padding:0 10px;gap:8px}` plus a 24px icon box
 * holding an 18px glyph, `shared/client/sidebar-entry-core.ts`), so their glyph ink starts 13px into
 * the column and their label 42px. Inside the platform panel row (8px padding, 8px gap) those two
 * lines are reached by a 26px box: `8 + (26 - 16) / 2 = 13` and `8 + 26 + 8 = 42`.
 * Matching the neighbours is a CHOICE (the platform's own rows below — the workspace folders — sit at
 * 8px and 32px); it keeps the four plugin rows reading as one column. The label carries the accessible
 * name, so the glyph stays decoration.
 */

/** The glyph box in px: the neighbours' 24px icon box, placed to land on their two content lines. */
const GLYPH_BOX = 26

/** The glyph's own coordinate system: every path below is drawn inside 16 units. */
const GLYPH_UNITS = 16

/**
 * Trim a computed viewBox number: three decimals stay readable and are far below one pixel.
 * @param value - the raw number.
 * @returns the value rounded to three decimals.
 */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function PanelIcon(props: { size?: number; active?: boolean } = {}): unknown {
  const size = typeof props.size === 'number' && props.size > 0 ? props.size : 18
  // Scale the 16-unit glyph to `size` px and centre it: the viewBox widens to the number of units that
  // fills the box, and the glyph sits in the middle of it, so the ink starts (GLYPH_BOX - size) / 2 in.
  const units = round3((GLYPH_UNITS * GLYPH_BOX) / size)
  const inset = round3((units - GLYPH_UNITS) / 2)
  return createElement('svg', {
    'aria-hidden': 'true',
    width: String(GLYPH_BOX),
    height: String(GLYPH_BOX),
    viewBox: String(-inset) + ' ' + String(-inset) + ' ' + String(units) + ' ' + String(units),
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
