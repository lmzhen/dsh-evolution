/**
 * One namespace's parameter card.
 *
 * Structural local types on purpose: this package is distributed outside the
 * platform repository and a value import of another plugin is forbidden, so the
 * settings scope and its snapshot are declared by the shape the renderer hands
 * over (`getSnapshot`/`subscribe`, status/value/user/writable).
 */
import { createElement, useState, type ReactNode } from 'react'
import type { ClientParamField } from './generated-params.ts'
import type { MessageKey } from './messages.ts'
import type { ParamSectionSnapshot, ParamSectionSource } from './seam.ts'

/** Injected face: plain data and callbacks, plus the hook seat. */
export interface ParamCardFace {
  namespace: string
  fields: readonly ClientParamField[]
  t: (key: MessageKey) => string
  write: (field: string, value: unknown) => Promise<void>
  clear: (field: string) => Promise<void>
  hooks: { paramSection: ParamSectionSource }
}

/** Props the renderer binds for one card: the inject face plus its hook seat. */
export type ParamCardProps = ParamCardFace & {
  /** Bound from `hooks.paramSection` by the renderer. */
  readonly useParamSection: <T>(selector: (state: ParamSectionSnapshot) => T) => T
}

/** One cell's text: absent reads as a dash, containers as JSON. */
function format(value: unknown): string {
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/** Parse one typed value the way the command surface does: JSON, else raw text. */
function parse(draft: string): unknown {
  const text = draft.trim()
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/** Whether a value is a plain section object. */
function isSection(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface FieldRowProps {
  field: ClientParamField
  value: unknown
  overridden: boolean
  disabled: boolean
  t: (key: MessageKey) => string
  write: (field: string, value: unknown) => Promise<void>
  clear: (field: string) => Promise<void>
}

/** One parameter row: current value, source badge, write and reset controls. */
function FieldRow(props: FieldRowProps): ReactNode {
  const [draft, setDraft] = useState('')
  return createElement('div', { className: 'evolution-param-row' },
    createElement('code', null, props.field.id),
    createElement('span', { className: 'evolution-param-value' }, format(props.value)),
    createElement('span', { className: 'evolution-param-source' }, props.overridden ? props.t('overridden') : props.t('deployment')),
    createElement('input', {
      value: draft,
      disabled: props.disabled,
      placeholder: props.field.doc,
      onChange: (event: { target: { value: string } }) => { setDraft(event.target.value) },
    }),
    createElement('button', {
      disabled: props.disabled || draft.trim() === '',
      onClick: () => { void props.write(props.field.id, parse(draft)) },
    }, props.t('apply')),
    props.overridden
      ? createElement('button', {
        disabled: props.disabled,
        onClick: () => { void props.clear(props.field.id) },
      }, props.t('reset'))
      : null,
  )
}

/**
 * Render one namespace's card.
 * @param props - the card data, its callbacks, and the bound section hook.
 * @returns the card.
 */
export function ParamCard(props: ParamCardProps): ReactNode {
  const { t, fields, write, clear } = props
  const snapshot = props.useParamSection((state: ParamSectionSnapshot) => state)
  if (snapshot.status === 'loading') return createElement('p', null, t('loading'))
  if (snapshot.status === 'unavailable') return createElement('p', null, t('unavailable'))
  const user = isSection(snapshot.user) ? snapshot.user : {}
  const value = isSection(snapshot.value) ? snapshot.value : {}
  const disabled = !snapshot.writable
  return createElement('section', { className: 'evolution-params' },
    createElement('h4', null, t('title') + ' — ' + props.namespace),
    disabled ? createElement('p', null, t('readonly')) : null,
    fields.length === 0
      ? createElement('p', null, t('empty'))
      : fields.map(field => createElement(FieldRow, {
        key: field.id,
        field,
        value: value[field.id],
        overridden: Object.hasOwn(user, field.id),
        disabled,
        t,
        write,
        clear,
      })),
  )
}
