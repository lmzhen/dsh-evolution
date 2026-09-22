/**
 * One namespace's parameter card.
 *
 * Structural local types on purpose: this package is distributed outside the
 * platform repository and a value import of another plugin is forbidden, so the
 * settings scope and its snapshot are declared by the shape the renderer hands
 * over (\`getSnapshot\`/\`subscribe\`, status/value/user/writable).
 *
 * Layout and behaviour follow the platform's own settings fields: a collapsed card
 * header (namespace title, change count, chevron), then one block per field —
 * label with its unit and source chip, a control HOLDING THE CURRENT VALUE, the
 * Chinese hint — and one 放弃修改/保存 pair at the card's foot. The control is
 * typed from the registry (\`control\`), so booleans are switches, enums are
 * selects and numbers are numeric inputs with the unit shown beside the label.
 */
import { createElement, useEffect, useState, type ReactNode } from 'react'
import type { ClientParamField } from './generated-params.ts'
import { NAMESPACE_TITLES, type MessageKey } from './messages.ts'
import { landedWrites, type PendingWrite } from './settle.ts'
import type { ParamSectionSnapshot, ParamSectionSource } from './seam.ts'

/**
 * Injected face: plain data and callbacks, plus the hook seat.
 *
 * The `hooks` compartment belongs to the shell, not to the component: the
 * renderer binds its entries to `use<Name>` props and omits `hooks` from what
 * the component receives. A card that reads `props.hooks` therefore reads a prop
 * that never exists.
 */
export interface ParamCardFace {
  namespace: string
  fields: readonly ClientParamField[]
  t: (key: MessageKey) => string
  write: (field: string, value: unknown) => Promise<void>
  clear: (field: string) => Promise<void>
  hooks: { paramSection: ParamSectionSource }
}

/**
 * Props the renderer binds for one card: the inject face minus its hook compartment,
 * plus the seats bound from it. Spelled the way the shell derives it, so reaching for
 * `props.hooks` fails the type check instead of failing at runtime.
 */
export type ParamCardProps = Omit<ParamCardFace, 'hooks'> & {
  /** Bound from \`hooks.paramSection\` by the renderer. */
  readonly useParamSection: <T>(selector: (state: ParamSectionSnapshot) => T) => T
}

/** One cell's text: absent reads as an empty control, containers as JSON. */
function format(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/**
 * Parse one edited value into what the scope should receive.
 * @param control - the registry's control kind for the field.
 * @param text - the text the operator left in the control.
 * @returns the value handed to \`set\`; a string stays raw so the Host's own
 *   validation produces the error message the operator reads.
 */
function parseFor(control: ClientParamField['control'], text: string): unknown {
  const trimmed = text.trim()
  if (control === 'switch') return trimmed === 'true'
  if (control === 'number') {
    const parsed = Number(trimmed)
    return trimmed !== '' && Number.isFinite(parsed) ? parsed : trimmed
  }
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return trimmed
  }
}

/** Whether a value is a plain section object. */
function isSection(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface FieldBlockProps {
  field: ClientParamField
  text: string
  overridden: boolean
  disabled: boolean
  t: (key: MessageKey) => string
  onChange: (id: string, text: string) => void
  clear: (field: string) => Promise<void>
}

/** One field's control, typed from the registry. */
function FieldControl(props: FieldBlockProps): ReactNode {
  const { field, text } = props
  const id = 'evolution-param-' + field.id
  const common = { id, disabled: props.disabled, className: 'evolution-param-input' }
  if (field.control === 'switch') {
    return createElement('input', {
      ...common,
      className: 'evolution-param-check',
      type: 'checkbox',
      checked: text === 'true',
      onChange: (event: { target: { checked: boolean } }) => { props.onChange(field.id, String(event.target.checked)) },
    })
  }
  if (field.control === 'select') {
    return createElement('select', {
      ...common,
      className: 'evolution-param-select',
      value: text,
      onChange: (event: { target: { value: string } }) => { props.onChange(field.id, event.target.value) },
    }, [
      // A value the registry no longer lists (an older override, or a deployment
      // value outside the current enum) still gets an option: without it the select
      // renders blank and the operator cannot see what is actually configured.
      field.values.includes(text) || text === '' ? null : createElement('option', { key: text, value: text }, text),
      ...field.values.map(value => createElement('option', { key: value, value }, value)),
    ])
  }
  return createElement('input', {
    ...common,
    type: field.control === 'number' ? 'number' : 'text',
    value: text,
    onChange: (event: { target: { value: string } }) => { props.onChange(field.id, event.target.value) },
  })
}

/** One parameter field: label, control, hint, and its reset-to-deployment action. */
function FieldBlock(props: FieldBlockProps): ReactNode {
  const { field, t } = props
  const unit = field.unit === '' ? null : createElement('span', { className: 'evolution-param-unit' }, '（' + field.unit + '）')
  return createElement('div', { className: 'evolution-param-field' },
    createElement('div', { className: 'evolution-param-label' },
      createElement('label', { htmlFor: 'evolution-param-' + field.id }, field.label === '' ? field.id : field.label),
      unit,
      createElement('span', {
        className: 'evolution-param-source',
        'data-user': props.overridden ? 'true' : 'false',
      }, props.overridden ? t('overridden') : t('deployment')),
    ),
    FieldControl(props),
    createElement('p', { className: 'evolution-param-hint' }, field.hint === '' ? field.doc : field.hint),
    props.overridden
      ? createElement('div', { className: 'evolution-param-actions' },
        createElement('button', {
          type: 'button',
          className: 'evolution-param-button',
          disabled: props.disabled,
          onClick: () => { void props.clear(field.id) },
        }, t('reset')),
      )
      : null,
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
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<readonly PendingWrite[] | null>(null)
  const snapshot = props.useParamSection((state: ParamSectionSnapshot) => state)
  if (snapshot.status === 'loading') return createElement('p', { className: 'evolution-param-note' }, t('loading'))
  if (snapshot.status === 'unavailable') return createElement('p', { className: 'evolution-param-note' }, t('unavailable'))
  const user = isSection(snapshot.user) ? snapshot.user : {}
  const value = isSection(snapshot.value) ? snapshot.value : {}
  const disabled = !snapshot.writable
  // Controls lock while a write is in flight: the drafts this save staged are the ones
  // the settling effect clears, so typing over them would lose the newer text.
  const locked = disabled || busy
  const titleKey = NAMESPACE_TITLES[namespace] as MessageKey | undefined
  const title = titleKey === undefined ? namespace : t(titleKey)
  const changed = fields.filter(field => Object.hasOwn(user, field.id)).length
  const textOf = (field: ClientParamField): string => draft[field.id] ?? format(value[field.id])
  const dirty = fields.filter(field => draft[field.id] !== undefined && draft[field.id] !== format(value[field.id]))
  const change = (id: string, next: string): void => { setDraft({ ...draft, [id]: next }) }
  /**
   * Settle a staged write against the Host's answer.
   *
   * A resolved write promise is not the verdict: both settings scopes this bundle runs
   * on (the shell's own controller and the bridge variant) finish their recovery read
   * BEFORE it resolves, so a value the Host refused is simply still the previous one.
   * Presence in the user layer therefore cannot answer the question — on a field the
   * operator had already overridden, a refused value's key is present as well. The
   * verdict asks whether each staged id now holds the value this card requested.
   * The check lives in an effect, not in the save callback, because the raw snapshot is
   * reachable only through the render-time seat — the face's `hooks` compartment never
   * reaches the component.
   */
  useEffect(() => {
    if (pending === null) return
    setPending(null)
    setBusy(false)
    if (landedWrites(pending, snapshot.user)) setDraft({})
    else setError(t('refused'))
  }, [pending, snapshot.user, t])
  const save = (): void => {
    setBusy(true)
    setError('')
    void (async () => {
      try {
        for (const field of dirty) await write(field.id, parseFor(field.control, textOf(field)))
        setPending(dirty.map(field => ({ id: field.id, want: parseFor(field.control, textOf(field)) })))
      } catch (caught) {
        // Transport-level failures (and any future shell that rejects): keep the draft
        // so nothing the operator typed is lost.
        setBusy(false)
        setError(caught instanceof Error && caught.message !== '' ? caught.message : t('refused'))
      }
    })()
  }
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
          : fields.map(field => createElement(FieldBlock, {
            key: field.id,
            field,
            text: textOf(field),
            overridden: Object.hasOwn(user, field.id),
            disabled: locked,
            t,
            onChange: change,
            clear,
          })),
        error === '' ? null : createElement('p', { className: 'evolution-param-error' }, error),
        fields.length === 0 ? null : createElement('div', { className: 'evolution-param-footer' },
          createElement('button', {
            type: 'button',
            className: 'evolution-param-button',
            disabled: busy || dirty.length === 0,
            onClick: () => { setDraft({}); setError('') },
          }, t('discard')),
          createElement('button', {
            type: 'button',
            className: 'evolution-param-button',
            'data-primary': 'true',
            disabled: disabled || busy || dirty.length === 0,
            onClick: save,
          }, busy ? t('saving') : t('apply')),
        ),
      )
      : null,
  )
}
