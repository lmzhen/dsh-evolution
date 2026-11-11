/**
 * One family row's card body, rendered from a supplied `state` + `mutate` pair.
 *
 * The family's settings page builds that pair from the platform's own client settings seat
 * (`ConfigPageForm`: the snapshot this render read, one revision-fenced `mutate` per save), so
 * this component owns no subscription and no seat probe of its own — its caller re-renders it,
 * exactly as the Plugins page does for a `plugins.row.config` entry whose `form` it supplies.
 * `summary` answers a one-line slot: a row's description fallback, which stays empty until the
 * row actually overrides something.
 * @module @deepseek-ai/dsh-evolution-ui/panels/settings/client
 */
import { createElement, type ReactNode } from 'react'
import type { ClientParamField } from './generated-params.ts'
import type { MessageKey } from './messages.ts'
import { fieldKeyOf, ParamCardView, type ParamLanguage } from './ParamCard.ts'
import { isSection, sectionSnapshotOf } from './source.ts'
import type { RowConfigViewProps } from './seam.ts'

/** The inject face every row registration carries (the page supplies `view` and `form`). */
export interface RowConfigFace {
  /** The row's entry id, for the card title. */
  namespace: string
  fields: readonly ClientParamField[]
  t: (key: MessageKey, values?: Readonly<Record<string, string | number>>) => string
  /** Current UI language for generated labels; omitted defaults to zh. */
  lang?: () => ParamLanguage
}

/** Props one row entry is rendered with: the page's seat plus this row's own face. */
export type RowConfigCardProps = RowConfigViewProps & RowConfigFace

/**
 * Count the keys this row's user layer holds.
 * @param user - the raw user section, as the page reports it.
 * @param fields - the row's fields.
 * @returns how many of them the user overrode.
 */
function overridden(user: unknown, fields: readonly ClientParamField[], namespace: string): number {
  const layer = isSection(user) ? user : {}
  return fields.filter(field => Object.hasOwn(layer, fieldKeyOf(namespace, field))).length
}

/**
 * Render one row's configuration entry.
 * @param props - the page's view/form seat plus this row's face.
 * @returns the entry; `summary` renders nothing for an untouched row (the page then keeps the row's own description).
 */
export function RowConfigCard(props: RowConfigCardProps): ReactNode {
  const { t, fields, namespace, view, form, lang } = props
  if (form === undefined) {
    // The page renders an entry only for a row it lists; no form means the deployment did
    // not compose the settings surface, so the page view says so instead of drawing dead controls.
    return view === 'summary' ? null : createElement('p', { className: 'evolution-param-note', role: 'status' }, t('seatMissing'))
  }
  const changed = overridden(form.state.user, fields, namespace)
  if (view === 'summary') {
    return changed === 0 ? null : createElement('span', null, t('changed', { n: changed }))
  }
  return ParamCardView({
    namespace,
    fields,
    t,
    ...(lang === undefined ? {} : { lang }),
    snapshot: sectionSnapshotOf(form.state),
    // T5-01/A56: ONE fenced write per SAVE. The fence stays (it is what keeps a concurrent editor
    // from being overwritten) — it just covers the whole op list instead of one field at a time, and
    // the revision is the one this render read, which is exactly what the platform's form model does.
    // G5 P1-1: the Host's boolean IS the verdict, so the entry FORWARDS it (the old body awaited and
    // dropped it, which made every write read as refused once the card trusted the return value).
    mutateOnce: async ops => form.mutate(ops, form.state.revision),
    clear: async field => form.mutate([{ op: 'unset', path: [field] }], form.state.revision),
  })
}
