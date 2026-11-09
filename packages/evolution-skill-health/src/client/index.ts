/**
 * Browser half: the health view inside the shared evolution workbench.
 * @module @deepseek-ai/dsh-evolution-skill-health/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import { registerWorkbenchView } from '@lmzhen/dsh-evolution-client-kit'
import * as api from './api.ts'
import { PANEL_ID, PANEL_ORDER } from './ids.ts'
import { NS, dictionaries } from './messages.ts'
import { SkillHealthPanel, type HealthFace } from './Panel.ts'
import { CSS, CSS_TAG_ID } from './styles.ts'
import { requireClientSeats } from '@lmzhen/dsh-evolution-client-kit'

/** Required client services: the slot registry, locale seat and page navigation. */
export const inject = ['slots', 'locale']

/** The host half hands the panel a way to read its rows (a read-only route on the host side). */
export type HealthFaceLoader = () => Promise<HealthFace>

export { PANEL_ID, PANEL_ORDER }

/** The view component receives the workbench's activeView marker alongside its face. */
function HealthView(props: HealthFace & { activeView?: string; openHistory?: (name: string) => void }): ReactNode {
  if (props.activeView !== 'health') return null
  return props.openHistory === undefined ? SkillHealthPanel(props) : SkillHealthPanel({ ...props, openHistory: props.openHistory })
}

/**
 * Register the health view on the workbench page.
 * @param ctx - the client context; it must carry the seats above.
 */
export function apply(ctx: ClientContext): void {
  requireClientSeats(ctx, 'skill-health')
  registerWorkbenchView<HealthFace>(ctx, {
    id: PANEL_ID,
    order: PANEL_ORDER,
    namespace: NS,
    dictionaries,
    styles: { css: CSS, tagId: CSS_TAG_ID },
    component: HealthView as unknown as (props: never) => ReactNode,
    face: (t: (key: string, values?: Readonly<Record<string, string | number>>) => string) => ({
      rows: [], proposals: [], truncated: false, loaded: false, proposalStatus: 'unavailable', loadRows: api.rows,
      t,
    }),
  })
}
