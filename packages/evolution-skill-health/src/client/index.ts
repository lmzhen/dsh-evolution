/**
 * Browser half: one left-sidebar row (技能健康) and the main-column body it opens.
 * @module @deepseek-ai/dsh-evolution-skill-health/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement, type ReactElement } from 'react'
import { registerSidebarPanel } from '@deepseek-ai/dsh-evolution-client-kit'
import * as api from './api.ts'
import { PANEL_ID, PANEL_ORDER } from './ids.ts'
import { NS, en, zh } from './messages.ts'
import { SkillHealthPanel, type HealthFace } from './Panel.ts'
import { CSS, CSS_TAG_ID } from './styles.ts'

/** Required client services: the slot registry and the locale seat. */
export const inject = ['slots', 'locale']

/** The host half hands the panel a way to read its rows (a read-only route on the host side). */
export type HealthFaceLoader = () => Promise<HealthFace>

export { PANEL_ID, PANEL_ORDER }

function PanelIcon(props: { size?: number; active?: boolean } = {}): ReactElement {
  const size = typeof props.size === 'number' && props.size > 0 ? props.size : 16
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
  }, createElement('path', { d: 'M2 8h3l1.5-3.5L9 11.5 10.5 8H14' }))
}

/**
 * Register the row and the body through the shared panel lifecycle.
 * @param ctx - the client context; it must carry the two seats above.
 */
export function apply(ctx: ClientContext): void {
  registerSidebarPanel<HealthFace>(ctx, {
    id: PANEL_ID,
    order: PANEL_ORDER,
    namespace: NS,
    dictionaries: { zh, en },
    styles: { css: CSS, tagId: CSS_TAG_ID },
    icon: PanelIcon,
    component: SkillHealthPanel as unknown as (props: never) => ReactElement,
    body: t => ({ rows: [], truncated: false, loadRows: api.rows, t }),
  })
}
