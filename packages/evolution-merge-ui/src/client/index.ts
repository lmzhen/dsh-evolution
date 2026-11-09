/** Browser half: one read-only merge view inside the shared evolution workbench. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement, type ReactNode } from 'react'
import { createSettingsSeat, panelWorkspaceId, registerWorkbenchView } from '@lmzhen/dsh-evolution-client-kit'
import * as api from './api.ts'
import { PANEL_ID, PANEL_ORDER } from './ids.ts'
import { NS, en, zh } from './messages.ts'
import { MergePanel, type MergeFace } from './Panel.ts'
import { MergeStore, type MergeSource } from './MergeStore.ts'
import { CSS, CSS_TAG_ID } from './styles.ts'
import { currentSessionId } from './session.ts'

export const inject = ['slots', 'sessions', 'locale']

/** The view component receives the workbench's activeView marker alongside its face. */
function MergeView(props: MergeFace & { activeView?: string }): ReactNode {
  return createElement('div', { hidden: props.activeView !== 'merge' }, MergePanel(props))
}

/**
 * Register the merge view on the workbench page.
 * @param ctx - the client context.
 */
export function apply(ctx: ClientContext): void {
  const seat = createSettingsSeat(ctx as unknown as { get?: (name: string) => unknown })
  const source: MergeSource = { view: api.view, rows: api.rows, body: api.body, history: api.history }
  const store = new MergeStore(source)
  ctx.effect(() => () => { store.dispose(); seat.dispose?.() }, 'evolution-merge-ui: settings seat + store')
  registerWorkbenchView<MergeFace>(ctx, {
    id: PANEL_ID,
    order: PANEL_ORDER,
    namespace: NS,
    dictionaries: { zh, en },
    styles: { css: CSS, tagId: CSS_TAG_ID },
    component: MergeView as unknown as (props: never) => ReactNode,
    face: (t: (key: string, values?: Readonly<Record<string, string | number>>) => string) => {
      const workspaceId = panelWorkspaceId(ctx)
      return {
        store,
        t,
        doctorCommand: '/evolution doctor',
        settings: { ...(seat.get('evolution-merge') === undefined ? {} : { merge: seat.get('evolution-merge')! }), ...(seat.get('evolution-approval') === undefined ? {} : { platform: seat.get('evolution-approval')! }) },
        decide: async (rowId: string, verb: 'approve' | 'reject') => {
          const sessionId = currentSessionId(ctx)
          if (sessionId === undefined) return { ok: false, message: t('session.missing') }
          const result = await api.decide(rowId, verb, sessionId)
          if (result.ok) return result.payload
          const failure = result.failure
          return { ok: false, message: 'message' in failure && typeof failure.message === 'string' ? failure.message : t('decide.failed') }
        },
        ...(workspaceId === undefined ? {} : { workspaceId }),
      }
    },
  })
}
