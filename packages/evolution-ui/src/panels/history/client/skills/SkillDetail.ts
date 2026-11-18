/**
 * The right rail of the skill page: the selected skill's header, versions and expanded rows.
 *
 * Presentational on purpose: the page owns read tickets, pending undo, expanded row and caches; this
 * file reads those facts as props. That keeps the list and detail markup out of the state machine
 * while preserving the existing semantics (one open row, one open skill).
 * @module @deepseek-ai/dsh-evolution-ui/panels/history/client
 */
import { createElement, type ReactNode } from 'react'
import { emptyState, groupHeading, localTime, notice, panelHead, versionRow, type Copy, type OpenKind } from '../chrome.ts'
import type { SkillRow, VersionRow } from '../api.ts'
import type { SkillErrorNote } from '@deepseek-ai/dsh-evolution-core/skills'
import type { HistoryViewModel } from '../history-presentation.ts'

export interface SkillDetailProps {
  readonly copy: Copy
  readonly onRefresh: () => void
  readonly selected: string | undefined
  readonly noteText: string | undefined
  readonly noteError: boolean
  readonly errorNotes: readonly SkillErrorNote[]
  readonly failureNode: ReactNode
  readonly skills: readonly SkillRow[]
  readonly skillsLoaded: boolean
  readonly loaded: boolean
  readonly versionsFailed: string | undefined
  readonly model: HistoryViewModel | undefined
  readonly pending: number | undefined
  readonly expanded: { readonly v: number; readonly kind: OpenKind } | undefined
  readonly expandedOf: (row: VersionRow) => ReactNode
  readonly onRestore: (v: number, unitId?: string) => void
  readonly onCancelRestore: () => void
  readonly onToggle: (v: number, kind: OpenKind) => void
}

/**
 * Render the selected skill's column.
 * @param props - copy, read state and callbacks.
 * @returns the main element.
 */
export function SkillDetail(props: SkillDetailProps): ReactNode {
  const group = (title: string, entries: readonly VersionRow[], note: string | undefined): ReactNode => {
    if (entries.length === 0) return null
    return createElement('section', { key: title },
      ...groupHeading(title, note),
      ...entries.map(row => versionRow({
        copy: props.copy,
        row,
        confirming: props.pending === row.v,
        open: props.expanded !== undefined && props.expanded.v === row.v ? props.expanded.kind : undefined,
        expanded: props.expandedOf(row),
        onRestore: () => { props.onRestore(row.v, row.unitId) },
        onCancel: props.onCancelRestore,
        onToggle: (kind: OpenKind) => { props.onToggle(row.v, kind) },
      })))
  }

  const model = props.model
  return createElement('div', { className: 'evo-hist-main' },
    panelHead(props.copy, props.onRefresh, props.selected ?? props.copy.t('bodyTitle'), props.selected),
    notice(props.noteText, props.noteError),
    props.errorNotes.length === 0
      ? null
      : createElement('section', { className: 'evo-hist-errors' },
        createElement('h3', { className: 'evo-hist-group' }, props.copy.t('errors.title')),
        createElement('ul', { className: 'evo-hist-error-list' },
          props.errorNotes.map((entry, index) => createElement('li', {
            key: entry.at + ':' + index,
            className: 'evo-hist-error-row',
          },
          createElement('time', null, localTime(entry.at)),
          createElement('span', null, entry.note))))),
    props.failureNode,
    props.selected === undefined
      ? [
        emptyState(props.copy.t(props.skills.length === 0 ? (props.skillsLoaded ? 'empty.skills.main' : 'loading') : 'empty.pick'), 'empty'),
        createElement('p', { key: 'hint', className: 'evo-hist-hint' }, props.copy.t('hint')),
      ]
      : props.loaded
        ? null
        : emptyState(props.versionsFailed === undefined ? props.copy.t('loading') : `${props.copy.t('empty.versions.failed')} — ${props.versionsFailed}`),
    props.loaded && model !== undefined
      ? createElement('div', { className: 'evo-hist-reader' },
        model.current.length === 0 ? null : createElement('section', { key: 'current', className: 'evo-hist-current' },
          ...groupHeading(props.copy.t('group.current'), undefined),
          ...model.current.map(row => versionRow({
            copy: props.copy,
            row,
            confirming: props.pending === row.v,
            open: props.expanded !== undefined && props.expanded.v === row.v ? props.expanded.kind : undefined,
            expanded: props.expandedOf(row),
            onRestore: () => { props.onRestore(row.v, row.unitId) },
            onCancel: props.onCancelRestore,
            onToggle: (kind: OpenKind) => { props.onToggle(row.v, kind) },
          }))),
        group(props.copy.t('group.history'), model.older, undefined),
        model.support.length === 0 ? null : group(props.copy.t('group.support'), model.support, props.copy.t('group.support.note')),
        model.hasAny ? null : createElement('p', { className: 'evo-hist-hint' }, props.copy.t('empty.versions')))
      : null,
  )
}
