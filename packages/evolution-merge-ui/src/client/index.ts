/** Browser half: one read-only merge view inside the shared evolution workbench. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement, useEffect, type ReactNode } from 'react'
import { panelWorkspaceId, registerSurface, type ConfigFormsSeat } from '@lmzhen/dsh-evolution-client-kit'
import * as api from './api.ts'
import { PANEL_ID, PANEL_ORDER } from './ids.ts'
import { NS, dictionaries } from './messages.ts'
import { MergePanel, type MergeFace } from './Panel.ts'
import { MergeStore, type MergeSource } from './MergeStore.ts'
import { CSS, CSS_TAG_ID } from './styles.ts'
import { currentSessionId } from './session.ts'

export const inject = ['slots', 'sessions', 'locale']

/** The active tab mounts the panel; an inactive tab must not run its host reads or focus listeners. */
export function MergeView(props: MergeFace & { activeView?: string }): ReactNode {
  const active = props.activeView === 'merge'
  // The store is owned by apply() and survives unmount, so a returning tab would otherwise show
  // the snapshot it left behind. Refresh on the inactive->active transition, not in the background.
  useEffect(() => { if (active) props.store.refresh() }, [active, props.store])
  return active ? createElement(MergePanel, props) : null
}

/**
 * Register the merge view on the workbench page.
 * @param ctx - the client context.
 */
export function apply(ctx: ClientContext): void {
  // The platform settings shell owns the seat; the merge panel only renders the forms it serves.
  const seat = (ctx as unknown as { get?: (name: string) => unknown }).get?.('configForms') as ConfigFormsSeat | undefined
  const source: MergeSource = { view: api.view, rows: api.rows, body: api.body, history: api.history }
  const store = new MergeStore(source)
  ctx.effect(() => () => { store.dispose() }, 'evolution-merge-ui: store')
  registerSurface<MergeFace>(ctx, {
    surface: 'workbench',
    id: PANEL_ID,
    order: PANEL_ORDER,
    namespace: NS,
    dictionaries,
    styles: { css: CSS, tagId: CSS_TAG_ID },
    component: MergeView as unknown as (props: never) => ReactNode,
    face: (t: (key: string, values?: Readonly<Record<string, string | number>>) => string) => {
      return {
        store,
        t,
        doctorCommand: '/evolution doctor',
        settings: { ...(seat?.get('evolution-merge') === undefined ? {} : { merge: seat?.get('evolution-merge')! }), ...(seat?.get('evolution-approval') === undefined ? {} : { platform: seat?.get('evolution-approval')! }) },
        decide: async (rowId: string, verb: 'approve' | 'reject') => {
          const sessionId = currentSessionId(ctx)
          if (sessionId === undefined) return { ok: false, message: t('session.missing'), code: 'session-missing' }
          const result = await api.decide(rowId, verb, sessionId)
          if (result.ok) return result.payload
          const failure = result.failure
          return { ok: false, message: 'message' in failure && typeof failure.message === 'string' ? failure.message : t('decide.failed'), ...(failure.kind === 'problem' && failure.code !== undefined ? { code: failure.code } : {}) }
        },
        workspaceId: () => panelWorkspaceId(ctx),
      }
    },
  })
}
