/**
 * One namespace's parameter card.
 *
 * Structural local types on purpose: this package is distributed outside the
 * platform repository and a value import of another plugin is forbidden, so the
 * settings scope and its snapshot are declared by the shape the renderer hands
 * over (\`getSnapshot\`/\`subscribe\`, status/value/user/writable).
 *
 * The layout follows the platform's own settings fields: a collapsed card header
 * (namespace title, change count, chevron), then one block per field — label with
 * its unit and source chip, the control holding the CURRENT value, the hint — with
 * the field's own actions at the end. Steps 3 and 4 of the 0.7.0 redesign land
 * here; the typed controls and the card-level save/discard follow.
 */
import { createElement, useState, type ReactNode } from 'react'
import type { ClientParamField } from './generated-params.ts'
import { NAMESPACE_TITLES, type MessageKey } from './messages.ts'
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
  /** Bound from \`hooks.paramSection\` by the renderer. */
  readonly useParamSection: <T>(selector: (state: ParamSectionSnapshot) => T) => T
}

/** One cell's text: absent reads as a dash, containers as JSON. */
function format(value: unknown): string {
  if (value === undefined) return ''
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

interface FieldLabelProps {
  field: ClientParamField
  overridden: boolean
  t: (key: MessageKey) => string
}

/** One field's label: the registry's Chinese name, its unit, its source chip. */
function fieldLabel(props: FieldLabelProps): ReactNode {
  const { field, t } = props
  return createElement('div', { className: 'evolution-param-label' },
    createElement('label', { htmlFor: 'evolution-param-' + field.id }, field.label === '' ? field.id : field.label),
    field.unit === '' ? null : createElement('span', { className: 'evolution-param-unit' }, '（' + field.unit + '）'),
    createElement('span', {
      className: 'evolution-param-source',
      'data-user': props.overridden ? 'true' : 'false',
    }, props.overridden ? t('overridden') : t('deployment')),
  )
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

/** One parameter field: label, the control holding the current value, the hint. */
function FieldRow(props: FieldRowProps): ReactNode {
  const { field, t } = props
  // The draft starts as null so the control shows the CURRENT value until the
  // operator edits it; applying then writes only what actually changed.
  const [draft, setDraft] = useState<string | null>(null)
  const current = format(props.value)
  const text = draft ?? current
  const dirty = draft !== null && draft !== current
  return createElement('div', { className: 'evolution-param-field' },
    fieldLabel({ field, overridden: props.overridden, t }),
    createElement('input', {
      id: 'evolution-param-' + field.id,
      className: 'evolution-param-input',
      value: text,
      disabled: props.disabled,
      onChange: (event: { target: { value: string } }) => { setDraft(event.target.value) },
    }),
    createElement('p', { className: 'evolution-param-hint' }, field.hint === '' ? field.doc : field.hint),
    createElement('div', { className: 'evolution-param-actions' },
      props.overridden
        ? createElement('button', {
          type: 'button',
          className: 'evolution-param-button',
          disabled: props.disabled,
          onClick: () => { void props.clear(field.id) },
        }, t('reset'))
        : null,
      createElement('button', {
        type: 'button',
        className: 'evolution-param-button',
        'data-primary': 'true',
        disabled: props.disabled || !dirty,
        onClick: () => { void props.write(field.id, parse(text)) },
      }, t('apply')),
    ),
  )
}

/**
 * Render one namespace's card.
 * @param props - the card data, its callbacks, and the bound section hook.
 * @returns the card.
 */
export function ParamCard(props: ParamCardProps): ReactNode {
  const { t, fields, write, clear, namespace } = props
  const [open, setOpen] = useState(false)
  const snapshot = props.useParamSection((state: ParamSectionSnapshot) => state)
  if (snapshot.status === 'loading') return createElement('p', { className: 'evolution-param-note' }, t('loading'))
  if (snapshot.status === 'unavailable') return createElement('p', { className: 'evolution-param-note' }, t('unavailable'))
  const user = isSection(snapshot.user) ? snapshot.user : {}
  const value = isSection(snapshot.value) ? snapshot.value : {}
  const disabled = !snapshot.writable
  const titleKey = NAMESPACE_TITLES[namespace] as MessageKey | undefined
  const title = titleKey === undefined ? namespace : t(titleKey)
  const changed = fields.filter(field => Object.hasOwn(user, field.id)).length
  return createElement('section', { className: 'evolution-param-card' },
    createElement('button', {
      type: 'button',
      className: 'evolution-param-head',
      'aria-expanded': open ? 'true' : 'false',
      onClick: () => { setOpen(!open) },
    },
    createElement('span', { className: 'evolution-param-card-title' }, title),
    changed === 0 ? null : createElement('span', { className: 'evolution-param-count' }, t('changed').replace('{n}', String(changed))),
    createElement('span', { className: 'evolution-param-chevron' }, open ? '▲' : '▼'),
    ),
    open
      ? createElement('div', { className: 'evolution-param-body' },
        disabled ? createElement('p', { className: 'evolution-param-note' }, t('readonly')) : null,
        fields.length === 0
          ? createElement('p', { className: 'evolution-param-note' }, t('empty'))
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
      : null,
  )
}
