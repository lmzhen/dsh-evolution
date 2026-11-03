/** Browser half: one read-only merge view inside the shared evolution workbench. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import { panelWorkspaceId, registerWorkbenchView } from '@lmzhen/dsh-evolution-client-kit'
import * as api from './api.ts'
import type { ConfigFormsSeat } from '@lmzhen/dsh-evolution-client-kit'
import { PANEL_ID, PANEL_ORDER } from './ids.ts'
import { NS, en, zh } from './messages.ts'
import { MergePanel, type MergeFace } from './Panel.ts'
import { MergeStore, type MergeSource } from './MergeStore.ts'
import { CSS, CSS_TAG_ID } from './styles.ts'

export const inject = ['slots', 'locale']

/** The view component receives the workbench's activeView marker alongside its face. */
function MergeView(props: MergeFace & { activeView?: string }): ReactNode { return props.activeView === 'merge' ? MergePanel(props) : null }

/**
 * Register the merge view on the workbench page.
 * @param ctx - the client context.
 */
export function apply(ctx: ClientContext): void {
  registerWorkbenchView<MergeFace>(ctx, {
    id: PANEL_ID,
    order: PANEL_ORDER,
    namespace: NS,
    dictionaries: { zh, en },
    styles: { css: CSS, tagId: CSS_TAG_ID },
    component: MergeView as unknown as (props: never) => ReactNode,
    face: (t: (key: string, values?: Readonly<Record<string, string | number>>) => string) => {
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
