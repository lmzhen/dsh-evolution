/** Browser half: one sidebar row and the read-only Batch 4 panel. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement, type ReactElement } from 'react'
import { panelWorkspaceId, registerSidebarPanel } from '@deepseek-ai/dsh-evolution-client-kit'
import * as api from './api.ts'
import type { ConfigFormsSeat } from '@deepseek-ai/dsh-evolution-client-kit'
import { PANEL_ID, PANEL_ORDER } from './ids.ts'
import { NS, en, zh } from './messages.ts'
import { MergePanel, type MergeFace } from './Panel.ts'
import { MergeStore, type MergeSource } from './MergeStore.ts'
import { CSS, CSS_TAG_ID } from './styles.ts'

export const inject = ['slots', 'locale']

function PanelIcon(props: { size?: number; active?: boolean } = {}): ReactElement {
  const size = typeof props.size === 'number' && props.size > 0 ? props.size : 16
  return createElement('svg', {
    'aria-hidden': 'true', width: String(size), height: String(size), viewBox: '0 0 16 16',
    fill: 'none', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round',
  }, createElement('path', { d: 'M3 4h10M3 8h6M3 12h8' }))
}

/**
 * Register the merge row and its keyed main body through the shared panel lifecycle.
 * @param ctx - the client context.
 */
export function apply(ctx: ClientContext): void {
  registerSidebarPanel<MergeFace>(ctx, {
    id: PANEL_ID,
    order: PANEL_ORDER,
    namespace: NS,
    dictionaries: { zh, en },
    styles: { css: CSS, tagId: CSS_TAG_ID },
    icon: PanelIcon,
    component: MergePanel as unknown as (props: never) => ReactElement,
    body: t => {
      const source: MergeSource = { view: api.view, rows: api.rows, body: api.body, history: api.history }
      let seat: ConfigFormsSeat | undefined
      try { seat = (ctx as unknown as { get?: (name: string) => unknown }).get?.('configForms') as ConfigFormsSeat | undefined } catch { seat = undefined }
      const workspaceId = panelWorkspaceId(ctx)
      return {
        store: new MergeStore(source),
        t,
        doctorCommand: '/evolution doctor',
        settings: { ...(seat === undefined ? {} : { merge: seat.get('evolution-merge'), platform: seat.get('evolution-approval') }) },
        ...(workspaceId === undefined ? {} : { workspaceId }),
      }
    },
  })
}
