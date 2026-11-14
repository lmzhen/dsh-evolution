/**
 * One family row's card body, rendered from a supplied `state` + `mutate` pair.
 *
 * The family's settings page builds that pair from the platform's own client settings seat
 * (`ConfigPageForm`: the snapshot this render read, one revision-fenced `mutate` per save), so
 * this component owns no subscription and no seat probe of its own — its caller re-renders it.
 * @module @deepseek-ai/dsh-evolution-ui/panels/settings/client
 */
import { createElement, type ReactNode } from 'react'
import type { ClientParamField } from './generated-params.ts'
import type { MessageKey } from './messages.ts'
import { ParamCardView, type ParamLanguage } from './ParamCard.ts'
import { sectionSnapshotOf } from './source.ts'
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
 * Render one row's configuration entry.
 * @param props - the page's form seat plus this row's face.
 * @returns the entry; without a form it states the missing seat instead of drawing dead controls.
 */
export function RowConfigCard(props: RowConfigCardProps): ReactNode {
  const { t, fields, namespace, form, lang } = props
  if (form === undefined) {
    return createElement('p', { className: 'evolution-param-note', role: 'status' }, t('seatMissing'))
  }
  return ParamCardView({
    namespace,
    fields,
    t,
    ...(lang === undefined ? {} : { lang }),
    snapshot: sectionSnapshotOf(form.state),
    revision: form.state.revision,
    // T5-01/A56: ONE fenced write per SAVE. The fence stays (it is what keeps a concurrent editor
    // from being overwritten) — it just covers the whole op list instead of one field at a time, and
    // the revision is the one this render read, which is exactly what the platform's form model does.
    // G5 P1-1: the Host's boolean IS the verdict, so the entry FORWARDS it (the old body awaited and
    // dropped it, which made every write read as refused once the card trusted the return value).
    mutateOnce: async (ops, baseRevision) => form.mutate(ops, baseRevision ?? form.state.revision),
    clear: async (field, baseRevision) => form.mutate([{ op: 'unset', path: [field] }], baseRevision ?? form.state.revision),
  })
}
