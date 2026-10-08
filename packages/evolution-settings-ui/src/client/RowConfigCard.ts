/**
 * The Plugins page's per-row configuration entry for a family row.
 *
 * The page owns the settings subscription — it re-renders the entry — and passes the row's
 * form in, so this component renders the SAME card body as our own section, fed by the
 * page's state instead of the bound hook and therefore holding no subscription of its own.
 * `summary` answers the page's one-line slot: a row's description fallback, which stays
 * empty until the row actually overrides something, exactly as the page expects.
 * @module @deepseek-ai/dsh-evolution-settings-ui/client
 */
import { createElement, type ReactNode } from 'react'
import type { ClientParamField } from './generated-params.ts'
import type { MessageKey } from './messages.ts'
import { ParamCardView } from './ParamCard.ts'
import { isSection, sectionSnapshotOf } from './source.ts'
import type { RowConfigViewProps } from './seam.ts'

/** The inject face every row registration carries (the page supplies `view` and `form`). */
export interface RowConfigFace {
  /** The row's entry id, for the card title. */
  namespace: string
  fields: readonly ClientParamField[]
  t: (key: MessageKey) => string
}

/** Props one row entry is rendered with: the page's seat plus this row's own face. */
export type RowConfigCardProps = RowConfigViewProps & RowConfigFace

/**
 * Count the keys this row's user layer holds.
 * @param user - the raw user section, as the page reports it.
 * @param fields - the row's fields.
 * @returns how many of them the user overrode.
 */
function overridden(user: unknown, fields: readonly ClientParamField[]): number {
  const layer = isSection(user) ? user : {}
  return fields.filter(field => Object.hasOwn(layer, field.id)).length
}

/**
 * Render one row's configuration entry.
 * @param props - the page's view/form seat plus this row's face.
 * @returns the entry; `summary` renders nothing for an untouched row (the page then keeps the row's own description).
 */
export function RowConfigCard(props: RowConfigCardProps): ReactNode {
  const { t, fields, namespace, view, form } = props
  if (form === undefined) {
    // The page renders an entry only for a row it lists; no form means the deployment did
    // not compose the settings surface, so the page view says so instead of drawing dead controls.
    return view === 'summary' ? null : createElement('p', { className: 'evolution-param-note' }, t('seatMissing'))
  }
  const changed = overridden(form.state.user, fields)
  if (view === 'summary') {
    return changed === 0 ? null : createElement('span', null, t('changed').replace('{n}', String(changed)))
  }
  return ParamCardView({
    namespace,
    fields,
    t,
    snapshot: sectionSnapshotOf(form.state),
    write: async (field, value) => { await form.mutate([{ op: 'set', path: [field], value }], form.state.revision) },
    clear: async (field) => { await form.mutate([{ op: 'unset', path: [field] }], form.state.revision) },
  })
}
