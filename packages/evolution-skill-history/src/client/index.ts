/**
 * Browser half: one left-sidebar panel row (技能历史) and the main-column body it opens.
 * @module @deepseek-ai/dsh-evolution-skill-history/client
 */
import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { registerSidebarPanel } from '@lmzhen/dsh-evolution-client-kit'
import { createSkillHistoryApi } from './api.ts'
import { en, fill, NS, zh } from './messages.ts'
import { CSS, CSS_TAG_ID } from './styles.ts'
import { SkillHistoryPanel } from './Panel.ts'
import { PANEL_ID } from './ids.ts'

/** Required client services: the slot registry and the locale seat. */
export const inject = ['slots', 'locale']

/** Row order inside the global panel list (beside the platform's own rows). */
export const PANEL_ORDER = 35

function PanelIcon(props: { size?: number; active?: boolean } = {}): unknown {
  const size = typeof props.size === 'number' && props.size > 0 ? props.size : 18
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
  const api = createSkillHistoryApi()
  registerSidebarPanel(ctx, {
    id: PANEL_ID,
    order: PANEL_ORDER,
    namespace: NS,
    dictionaries: { zh, en },
    fallback: 'en',
    styles: { css: CSS, tagId: CSS_TAG_ID },
    icon: PanelIcon,
    component: SkillHistoryPanel as unknown as (props: never) => ReturnType<typeof createElement>,
    body: t => ({
      t,
      format: (key: string, values: Record<string, string | number>) => fill(t(key), values),
      loadSkills: api.skills,
      loadVersions: api.versions,
      loadDiff: api.diff,
      loadBody: api.body,
      undo: api.undo,
      markdownWords: { copy: t('markdown.copy'), copied: t('markdown.copied'), footnotes: t('markdown.footnotes') },
    }),
  })
}
