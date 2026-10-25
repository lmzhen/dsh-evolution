/** Browser half: one sidebar row and the read-only Batch 4 panel. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement, type ReactElement } from 'react'
import * as api from './api.ts'
import { PANEL_ID, PANEL_ORDER, type ClientSeam, type ConfigFormsSeat } from './seam.ts'
import { NS, en, zh } from './messages.ts'
import { MergePanel, type MergeFace, type Translate } from './Panel.ts'
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

function interpolate(text: string, values?: Readonly<Record<string, string | number>>): string {
  if (values === undefined) return text
  return text.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ''))
}

/** Best-effort panel workspace; the merge panel itself is not workspace-keyed. */
function panelWorkspaceId(ctx: ClientContext): string | undefined {
  const get = (ctx as unknown as { get?: (name: string) => unknown }).get
  if (typeof get !== 'function') return undefined
  for (const name of ['workspace', 'uiWorkspace']) {
    try {
      const seat = get.call(ctx, name) as { readonly workspaceId?: unknown; readonly currentWorkspaceId?: unknown } | undefined
      const id = seat?.workspaceId ?? seat?.currentWorkspaceId
      if (typeof id === 'string' && id.trim() !== '') return id
    } catch { /* optional service: absence is the local scope */ }
  }
  return undefined
}

export function apply(ctx: ClientContext): void {
  const seam = ctx as unknown as ClientSeam
  let registered = false
  ctx.effect(() => {
    try { const dispose = seam.locale.register(NS, { zh, en }); registered = true; return dispose }
    catch (error) {
      ctx.logger.warn('evolution-merge-ui: locale seat refused "' + NS + '" (' + String(error) + ')')
      return () => {}
    }
  }, 'evolution-merge-ui: locale')
  ctx.effect(() => {
    if (document.querySelector('style[data-plugin-css="' + CSS_TAG_ID + '"]') !== null) return () => {}
    const tag = document.createElement('style')
    tag.setAttribute('data-plugin-css', CSS_TAG_ID)
    tag.textContent = CSS
    document.head.append(tag)
    return () => { tag.remove() }
  }, 'evolution-merge-ui: styles')
  const t: Translate = (key, values) => {
    const fallback = zh[key] ?? key
    let text = fallback
    if (registered) {
      try { text = seam.locale.bind(NS)(key) } catch { text = fallback }
    }
    return interpolate(text, values)
  }
  const label = (): string => t('entry.label')
  seam.slots.inject('sidebar.panellist', function* () {
    yield seam.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label },
      PanelIcon,
    )
    yield seam.slots.register(
      { name: 'main', key: PANEL_ID, inject: (): MergeFace => {
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
      } },
      MergePanel,
    )
  })
}
