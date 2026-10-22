/**
 * Browser half: one sidebar row ("技能合并") and the read-only main body it opens.
 * All facts arrive through the generated routes; the bundle holds no service and writes nothing.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement, type ReactElement } from 'react'
import * as api from './api.ts'
import { PANEL_ID, PANEL_ORDER, type ClientSeam } from './seam.ts'
import { NS, en, zh } from './messages.ts'
import { MergePanel, type MergeFace } from './Panel.ts'
import { CSS, CSS_TAG_ID } from './styles.ts'

export const inject = ['slots', 'locale']

function PanelIcon(props: { size?: number; active?: boolean } = {}): ReactElement {
  const size = typeof props.size === 'number' && props.size > 0 ? props.size : 16
  return createElement('svg', {
    'aria-hidden': 'true', width: String(size), height: String(size), viewBox: '0 0 16 16',
    fill: 'none', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round',
  }, createElement('path', { d: 'M3 4h10M3 8h6M3 12h8' }))
}

function seedView(): api.MergeViewPayload {
  return {
    counts: { verify: 0, pending: 0, fuse: 0, skipped: 0 },
    tabs: [{ queue: 'verify', count: 0 }, { queue: 'pending', count: 0 }, { queue: 'fuse', count: 0 }, { queue: 'skipped', count: 0 }],
    commands: [],
  }
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
  const t = (key: string): string => {
    const fallback = zh[key] ?? key
    if (!registered) return fallback
    try { return seam.locale.bind(NS)(key) } catch { return fallback }
  }
  const label = (): string => t('entry.label')
  seam.slots.inject('sidebar.panellist', function* () {
    yield seam.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label },
      PanelIcon,
    )
    yield seam.slots.register(
      { name: 'main', key: PANEL_ID, inject: (): MergeFace => ({ view: seedView(), rows: [], loadView: api.view, loadRows: api.rows, loadBody: api.body, loadHistory: api.history, t }) },
      MergePanel,
    )
  })
}
