/**
 * The family's settings page: one card per parameter namespace (grouped by task) and the
 * read-only diagnostics card.
 *
 * The row state and the write face come from the platform's own client settings seat, read as
 * the page's `state` + `mutate` pair — the same pair the Plugins page hands a
 * `plugins.row.config` entry. So the card body has ONE implementation (`RowConfigCard`) and
 * every save is ONE revision-fenced op list; this module owns only the grouping and the
 * re-render when a row's snapshot moves.
 * @module @deepseek-ai/dsh-evolution-ui/panels/settings/client
 */
import { createElement, useEffect, useState, type ReactNode } from 'react'
import type { ClientParamField } from './generated-params.ts'
import type { MessageKey } from './messages.ts'
import type { ParamLanguage } from './ParamCard.ts'
import { RowConfigCard } from './RowConfigCard.ts'
import { DiagnosticsCard } from './DiagnosticsCard.ts'
import type { DiagnosticsApi } from './diagnostics-state.ts'
import type { ConfigFormLike, ConfigFormsSeat, RowConfigForm } from './seam.ts'
import { FAMILY_VERSION } from './generated-about.ts'
import { groupParamCards } from './settings-groups.ts'

/** One namespace the page renders: its settings namespace (the Host entry id) and its fields. */
export interface SettingsCardFace {
  readonly namespace: string
  readonly fields: readonly ClientParamField[]
}

/** What the page needs from the apply closure: copy, the seat reader, and the two client calls. */
export interface EvolutionSettingsPageProps {
  readonly cards: readonly SettingsCardFace[]
  /** The platform's settings seat, read on every render (absent in a shell that composes no settings). */
  readonly seat: () => ConfigFormsSeat | undefined
  readonly t: (key: MessageKey, values?: Readonly<Record<string, string | number>>) => string
  readonly lang?: () => ParamLanguage
  readonly diagnostics: DiagnosticsApi
}

/**
 * The `state` + `mutate` pair the page hands a card, built exactly the way the Plugins page
 * builds it for a row entry: the snapshot this render read and one atomic write per save.
 * @param form - the seat's form for one namespace.
 * @returns the pair `RowConfigCard` renders and writes through.
 */
function formFace(form: ConfigFormLike): RowConfigForm {
  return {
    state: form.getSnapshot(),
    mutate: async (ops, revision) => await form.mutate(ops, revision),
  }
}

/**
 * Render the family settings page.
 * @param props - the cards, the seat reader, the copy seat and the diagnostics call.
 * @returns the page: its heading, the task groups with their cards, and the diagnostics card.
 */
export function EvolutionSettingsPage(props: EvolutionSettingsPageProps): ReactNode {
  const { cards, t } = props
  const [, bump] = useState(0)
  const seat = props.seat()
  // Recomputed per render: a card's form is the platform's shared per-namespace object, so this
  // costs one map lookup and never a second form. `namespace` is carried here because that is the
  // key `groupParamCards` partitions by (one spelling of a namespace, never a second field).
  const rows = cards.map(card => ({ namespace: card.namespace, card, form: seat?.get<Record<string, unknown>>(card.namespace) }))
  // The seat's forms notify on every settled read and write; a snapshot alone does not re-render.
  // The key makes the effect re-subscribe when a seat that was absent at first render appears.
  const binding = rows.map(row => row.form === undefined ? '-' : '+').join('')
  useEffect(() => {
    const dispose: (() => void)[] = []
    for (const row of rows) {
      if (row.form === undefined) continue
      dispose.push(row.form.subscribe(() => { bump(previous => previous + 1) }))
    }
    return () => { for (const off of dispose) off() }
  }, [props.cards, props.seat, binding])
  return createElement('div', { className: 'evolution-settings-tab evolution-params', 'data-role': 'evolution-settings' },
    createElement('h2', { className: 'evolution-params-title' }, t('title')),
    createElement('p', { className: 'evolution-params-subtitle' }, t('subtitle')),
    createElement('p', { className: 'evolution-params-about' }, FAMILY_VERSION + ' · ' + t('aboutPurpose')),
    ...groupParamCards(rows).flatMap(({ group, items }) => [
      createElement('h3', { key: 'group-' + group, className: 'evolution-settings-group', 'data-role': 'settings-group' }, t(('group.' + group) as MessageKey)),
      ...items.map(({ card, form }, index) => createElement(RowConfigCard, {
        key: card.namespace + ':' + String(index),
        view: 'page',
        ...(form === undefined ? {} : { form: formFace(form) }),
        namespace: card.namespace,
        fields: card.fields,
        t,
        ...(props.lang === undefined ? {} : { lang: props.lang }),
      })),
    ]),
    createElement(DiagnosticsCard, { key: 'diagnostics', t, api: props.diagnostics }),
  )
}
