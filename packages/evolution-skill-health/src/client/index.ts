/**
 * Browser half: the health view inside the shared evolution workbench.
 * @module @deepseek-ai/dsh-evolution-skill-health/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import { registerWorkbenchView } from '@lmzhen/dsh-evolution-client-kit'
import * as api from './api.ts'
import { PANEL_ID, PANEL_ORDER } from './ids.ts'
import { NS, en, zh } from './messages.ts'
import { SkillHealthPanel, type HealthFace } from './Panel.ts'
import { CSS, CSS_TAG_ID } from './styles.ts'
import { openSkillHistory, requireHealthSeats } from './seats.ts'

/** Required client services: the slot registry, locale seat and page navigation. */
export const inject = ['slots', 'locale', 'layout']

/** The host half hands the panel a way to read its rows (a read-only route on the host side). */
export type HealthFaceLoader = () => Promise<HealthFace>

export { PANEL_ID, PANEL_ORDER }

/** The view component receives the workbench's activeView marker alongside its face. */
function HealthView(props: HealthFace & { activeView?: string }): ReactNode {
  return props.activeView === 'health' ? SkillHealthPanel(props) : null
}

/**
 * Register the health view on the workbench page.
 * @param ctx - the client context; it must carry the seats above.
 */
export function apply(ctx: ClientContext): void {
  requireHealthSeats(ctx)
  registerWorkbenchView<HealthFace>(ctx, {
    id: PANEL_ID,
    order: PANEL_ORDER,
    namespace: NS,
    dictionaries: { zh, en },
    styles: { css: CSS, tagId: CSS_TAG_ID },
    component: HealthView as unknown as (props: never) => ReactNode,
    face: (t: (key: string, values?: Readonly<Record<string, string | number>>) => string) => ({
      rows: [], proposals: [], truncated: false, loaded: false, proposalStatus: 'unavailable', loadRows: api.rows,
      openHistory: (name: string) => { openSkillHistory(ctx, name) },
      t,
    }),
  })
}
