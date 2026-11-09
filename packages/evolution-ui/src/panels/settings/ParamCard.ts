/**
 * One namespace's parameter card.
 *
 * Structural local types on purpose: this package is distributed outside the
 * platform repository and a value import of another plugin is forbidden, so the
 * settings scope and its snapshot are declared by the shape the renderer hands
 * over (\`getSnapshot\`/\`subscribe\`, status/value/user/writable).
 *
 * header (namespace title, change count, chevron), then one block per field —
 * header (namespace title, change count, chevron), then one block per field —
 * label with its unit and source chip, a control HOLDING THE CURRENT VALUE, the
 * Chinese hint — and one 放弃修改/保存 pair at the card's foot. The control is
 * typed from the registry (\`control\`), so booleans are switches, enums are
 * selects and numbers are numeric inputs with the unit shown beside the label.
 */
import { createElement, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ClientParamField } from './generated-params.ts'
import { NAMESPACE_TITLES, type MessageKey } from './messages.ts'
import { PARAM_FIELDS, PARAM_GROUPS, PARAM_UNITS, PARAM_VALUES } from './generated-param-i18n.ts'
import type { SupportedLocale } from '@lmzhen/dsh-evolution-client-kit/generated/i18n'
/**
 * One staged write awaiting the Host's answer. The verdict is the Host's own boolean (the settings
 * scope performs a recovery read before it resolves), so this record carries only what the effect
 * needs to render: whether it was accepted, and whether it was a reset (which reads differently).
 */
type PendingWrite = { readonly accepted: boolean; readonly resets: boolean; readonly field?: string; readonly readbackFailed?: boolean; readonly kind?: 'conflict' | 'transport' | 'validation' }
import type { ParamSectionSnapshot, ParamSectionSource, SettingsPathOpLike, SettingsSaveResult } from './seam.ts'

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
  t: (key: MessageKey, values?: Readonly<Record<string, string | number>>) => string
  /** Current UI language for generated labels; omitted defaults to zh. */
  lang?: () => ParamLanguage
  /** ONE call per save, carrying every dirty field as one op list (T5-01/A56). The returned boolean IS
   * the Host's verdict (contract C2/G5): `true` = accepted, `false` = refused after its recovery read. */
  mutateOnce: (ops: readonly SettingsParamOp[]) => Promise<boolean>
  /** Structured write result; when present the card distinguishes acceptance from readback. */
  saveOnce?: (ops: readonly SettingsParamOp[]) => Promise<SettingsSaveResult>
  clear: (field: string) => Promise<boolean>
  /** Retry the section read after a transport failure. */
  retry?: (() => void) | undefined
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

/** Generated-copy language. */
export type ParamLanguage = SupportedLocale

type CopyRow = Readonly<Record<string, string>>

function fieldCopy(field: ClientParamField): { label?: CopyRow; hint?: CopyRow } | undefined {
  return (PARAM_FIELDS as Readonly<Record<string, { label: CopyRow; hint: CopyRow }>>)[field.id]
}

/** Resolve one localized enum value; an unknown value keeps its raw text. */
function valueOf(field: ClientParamField, value: string, lang: ParamLanguage): string {
  return (PARAM_VALUES as Readonly<Record<string, Readonly<Record<string, CopyRow>>>>)[field.id]?.[value]?.[lang] ?? value
}

/** Localized unit from the generated catalog, with the raw unit as the final fallback. */
function unitOf(field: ClientParamField, lang: ParamLanguage): string {
  return (PARAM_UNITS as Readonly<Record<string, CopyRow>>)[field.unit]?.[lang] ?? (lang === 'zh' ? field.unit : field.unitEn)
}

/** Resolve one field's user-language label. */
function labelOf(field: ClientParamField, lang: ParamLanguage): string {
  return fieldCopy(field)?.label?.[lang] ?? (lang === 'zh' ? field.label : (field.labelEn ?? field.label))
}

/** Resolve one field's user-language hint. */
function hintOf(field: ClientParamField, lang: ParamLanguage): string {
  return fieldCopy(field)?.hint?.[lang] ?? (lang === 'zh' ? field.hint : (field.hintEn ?? field.doc))
}

/** Resolve one field's user-language group heading. */
function groupOf(field: ClientParamField, lang: ParamLanguage): string {
  return (PARAM_GROUPS as Readonly<Record<string, CopyRow>>)[field.group]?.[lang] ?? (lang === 'zh' ? (field.groupLabel ?? field.group) : (field.groupLabelEn ?? field.group))
}

/** The op list a save hands to the seat — the seam's own shape, never a second vocabulary. */
export type SettingsParamOp = SettingsPathOpLike

/**
 * The NAMESPACE-RELATIVE key of one registry field.
 *
 * The E3 registry writes family ids in canonical form (`evolution-approval.pendingTtlMs`),
 * while the platform settings seat speaks a namespace's own field keys (`pendingTtlMs`) —
 * its snapshot user layer, its base and its op paths are all relative to the namespace. Sending
 * the canonical id as an op path makes the Host refuse the write
 * ("Config field evolution-approval.pendingTtlMs is not volatile", measured 2026-10-19), so the
 * card translates once, here, and every read/write goes through it.
 * @param namespace - the settings namespace (Loader row id) the card writes.
 * @param field - one generated field.
 * @returns the field's key inside that namespace.
 */
export function fieldKeyOf(namespace: string, field: ClientParamField): string {
  const prefix = namespace + '.'
  return field.id.startsWith(prefix) ? field.id.slice(prefix.length) : field.id
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

// G7.1/A8: the predicate is generated from core (guards.ts); the local name is kept.
import { isRecord as isSection } from './guards.ts'

interface FieldBlockProps {
  field: ClientParamField
  lang: ParamLanguage
  text: string
  overridden: boolean
  /** The card is busy (a save or another reset is in flight). */
  disabled: boolean
  /** THIS field's reset is in flight (T5-05/A60) — the button says so. */
  clearing: boolean
  t: (key: MessageKey, values?: Readonly<Record<string, string | number>>) => string
  onChange: (id: string, text: string) => void
  /** Ask for this field's deployment default back; the verdict is judged from the next snapshot. */
  onClear: (field: string) => void
  /** U-5: what that reset would restore (the seat's `base`), already spelled for the reader. */
  resetTo: string | null
  /** U-4: the fully rendered reason the current value is unacceptable, or null. */
  invalid: string | null
}

/**
 * U-4: whether one field's CURRENT text is a value the Host can take. The controls constrain their own
 * domains (a number input sanitizes, a select only offers listed values), so the reachable case is a
 * value the registry no longer lists — carried in the user layer and re-staged by any other edit.
 * @param field - the generated field.
 * @param text - the text the control holds right now.
 * @param peer - U-4: the text the row this field declares `atLeast` against currently holds (absent
 * when the field declares no relation, or when that row is not on this card).
 * @returns the message key explaining the refusal, or null when the value is acceptable.
 */
export function invalidReason(field: ClientParamField, text: string, peer?: string): MessageKey | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (field.control === 'number') {
    if (!Number.isFinite(Number(trimmed))) return 'invalidNumber'
    // The cross-field half of the same check the Host enforces (core's params.ts `relation`): the
    // card refuses the pair before a save is staged, so the operator learns it here rather than from
    // an E-322 after the fact.
    if (field.atLeast !== '' && peer !== undefined && peer.trim() !== '' && Number.isFinite(Number(peer))) {
      if (Number(trimmed) < Number(peer)) return 'invalidAtLeast'
    }
    return null
  }
  if (field.control === 'select') return field.values.includes(trimmed) ? null : 'invalidSelect'
  return null
}

/**
 * U-5: the value a reset would restore, spelled for a reader. Only primitives are shown: the seat's
 * `base` may be a nested object, and `[object Object]` is worse than saying nothing.
 * @param value - the seat's base value for one field.
 * @returns its display string, or null when it is not a primitive.
 */
function resetToOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

/**
 * The DOM id a field's control, its label and its explanation node all share. ONE definition: the
 * three call sites used to spell the string out, and the third one (the explanation node) referred to
 * a local that only existed inside the control — a ReferenceError on every invalid value, which the
 * unit-level fixture could not see because it never rendered one (independent review, P1-1).
 */
function controlId(field: ClientParamField): string {
  return 'evolution-param-' + field.id
}

/** One field's control, typed from the registry. */
function FieldControl(props: FieldBlockProps): ReactNode {
  const { field, text, lang } = props
  const id = controlId(field)
  // U-4: an unacceptable value must SAY so — invalid state plus a described explanation node.
  const common = {
    id,
    disabled: props.disabled,
    className: 'evolution-param-input',
    ...(props.invalid === null ? {} : { 'aria-invalid': 'true', 'aria-describedby': id + '-invalid' }),
  }
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
      // The option TEXT comes from the registry's display names; the option VALUE stays
      // the raw spelling the settings document stores (a translation here would write a
      // value the Host does not know).
      ...field.values.map(value => createElement('option', { key: value, value }, valueOf(field, value, lang))),
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
  const { field, t, lang } = props
  const unitText = unitOf(field, lang)
  const unit = unitText === '' ? null : createElement('span', { className: 'evolution-param-unit' }, (lang === 'zh' ? '（' : ' (') + unitText + (lang === 'zh' ? '）' : ')'))
  return createElement('div', { className: 'evolution-param-field' },
    createElement('div', { className: 'evolution-param-label' },
      createElement('label', { htmlFor: controlId(field) }, labelOf(field, lang) === '' ? field.id : labelOf(field, lang)),
      unit,
      // U-3: the chip IS the information "this field is overridden" — printing "deployment default" on
      // every untouched field is ten chips of zero information on the curator row alone.
      props.overridden
        ? createElement('span', { className: 'evolution-param-source', 'data-user': 'true' }, t('overridden'))
        : null,
      props.overridden
        ? createElement('button', {
          type: 'button',
          className: 'evolution-param-reset',
          disabled: props.disabled || props.clearing,
          'data-role': 'reset',
          title: props.resetTo === null ? undefined : t('resetTo', { value: props.resetTo }),
          onClick: () => { props.onClear(field.id) },
        }, props.clearing ? t('resetting') : t('reset'))
        : null,
    ),
    FieldControl(props),
    createElement('p', { className: 'evolution-param-hint' }, hintOf(field, lang) === '' ? field.doc : hintOf(field, lang)),
    props.invalid === null
      ? null
      : createElement('p', { id: controlId(field) + '-invalid', className: 'evolution-param-error', role: 'status' }, props.invalid),
  )
}

/**
 * Render one namespace's card.
 * @param props - the card data, its callbacks, and the bound section hook.
 * @returns the card.
 */
/** Props of the shared body: the card's own data plus the row state it renders. */
export interface ParamCardViewProps {
  namespace: string
  fields: readonly ClientParamField[]
  t: (key: MessageKey, values?: Readonly<Record<string, string | number>>) => string
  /** Current UI language for generated labels; omitted defaults to zh. */
  lang?: () => ParamLanguage
  /** ONE call per save, carrying every dirty field as one op list (T5-01/A56). */
  mutateOnce: (ops: readonly SettingsParamOp[]) => Promise<boolean>
  saveOnce?: (ops: readonly SettingsParamOp[]) => Promise<SettingsSaveResult>
  /** Ask the scope to drop one override; resolves when the scope answered, not when it landed. */
  clear: (field: string) => Promise<boolean>
  /** The current row state, from whichever source owns it (the bound hook or the page). */
  snapshot: ParamSectionSnapshot
}

/**
 * Render one row's card body from a supplied snapshot.
 * @param props - the card data, its callbacks, and the row state to render.
 * @returns the card.
 */
export function ParamCardView(props: ParamCardViewProps): ReactNode {
  const { t, fields, mutateOnce, saveOnce, clear, namespace, snapshot } = props
  const lang: ParamLanguage = props.lang?.() ?? 'zh'
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState<PendingWrite | null>(null)
  // The field whose reset is in flight (T5-05/A60): the button says so and the controls lock, the
  // same posture the save path takes while its write is outstanding.
  const [clearing, setClearing] = useState<string | null>(null)
  // hooks 区：所有 hook 无条件先跑；条件分支只决定输出（G4/4.0 S5-01 根治）
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
    setClearing(null)
    // G5 P1-1: the verdict is the HOST'S boolean. Comparing the settled user layer against the
    // requested values read a REFUSED write as accepted whenever the value already matched (a
    // concurrent editor, or a field the operator had already overridden) — the exact "refused but
    // reported as saved" defect. The platform resolves `false` for a refusal, so trust it.
    if (pending.readbackFailed === true) {
      setError(t('saveReadbackFailed'))
      return
    }
    if (!pending.accepted) {
      // A refused reset reads differently from a refused save: in the first the row still shows the
      // operator's value, which is what a reader who clicked "restore default" needs to be told.
      setError(t(pending.resets ? 'resetRefused' : pending.kind === 'conflict' ? 'saveConflict' : 'refused'))
      return
    }
    if (pending.accepted) {
      if (pending.resets) {
        const id = pending.field
        setDraft(current => { if (id === undefined) return current; const next = { ...current }; delete next[id]; return next })
        setNote(t('resetDone'))
      } else {
        setDraft({})
        setNote(t('saved'))
      }
    }
  }, [pending, snapshot.user, t])
  if (snapshot.status === 'loading') return createElement('p', { className: 'evolution-param-note', role: 'status' }, t('loading'))
  // Three different absences, told apart on screen because the operator's next move differs:
  // this UI has no settings seat (compose the settings surface), the seat serves no such row
  // (compose the row), or projecting that row failed (read the log). They must never read the
  // same, and none of them may be a blank card.
  if (snapshot.status === 'unavailable') {
    if (snapshot.reason === 'transport') {
      return createElement('div', { className: 'evolution-param-note', role: 'status' },
        createElement('p', null, t('unavailable')),
        createElement('button', { type: 'button', onClick: () => { (props as unknown as { retry?: () => void }).retry?.() } }, t('approvalRetry')))
    }
    const key: MessageKey = snapshot.reason === 'seat-missing'
      ? 'seatMissing'
      : snapshot.reason === 'projection-failed' ? 'projectionFailed' : 'unavailable'
    return createElement('p', { className: 'evolution-param-note', role: 'status' }, t(key))
  }
  const user = isSection(snapshot.user) ? snapshot.user : {}
  const value = isSection(snapshot.value) ? snapshot.value : {}
  const disabled = !snapshot.writable
  // Controls lock while a write is in flight: the drafts this save staged are the ones
  // the settling effect clears, so typing over them would lose the newer text. A reset in
  // flight locks them too — there is ONE pending batch per card, so a second click would
  // replace the batch the first click is still waiting on a verdict for (T5-05/A60).
  const locked = disabled || busy || clearing !== null
  const titleKey = NAMESPACE_TITLES[namespace] as MessageKey | undefined
  const title = titleKey === undefined ? namespace : t(titleKey)
  const hintKey: MessageKey | undefined = namespace === 'evolution-merge' ? 'mergeCardHint' : namespace === 'evolution-approval' ? 'approvalCardHint' : undefined
  const keyOf = (field: ClientParamField): string => fieldKeyOf(namespace, field)
  const changed = fields.filter(field => Object.hasOwn(user, keyOf(field))).length
  const textOf = (field: ClientParamField): string => draft[field.id] ?? format(value[keyOf(field)])
  const dirty = fields.filter(field => draft[field.id] !== undefined && draft[field.id] !== format(value[keyOf(field)]))
  // U-4 constraint-first: an unacceptable value blocks the save instead of being staged and refused.
  const invalidText = (field: ClientParamField): string | null => {
    const related = field.atLeast === '' ? undefined : fields.find(candidate => candidate.id === field.atLeast)
    const peer = related === undefined ? undefined : textOf(related)
    const reason = invalidReason(field, textOf(field), peer)
    if (reason === null) return null
    if (reason !== 'invalidAtLeast') return t(reason)
    const relatedLabel = related === undefined
      ? t('invalidAtLeastPeer')
      : (labelOf(related, lang) === '' ? related.id : labelOf(related, lang))
    const relatedUnit = related === undefined ? '' : unitOf(related, lang)
    return t(reason, { field: relatedLabel, n: peer ?? '', unit: relatedUnit === '' ? '' : ' ' + relatedUnit })
  }
  const blocked = fields.some(field => invalidText(field) !== null)
  const change = (id: string, next: string): void => { setDraft({ ...draft, [id]: next }) }
  /**
   * Restore one field's deployment default (T5-05/A60).
   *
   * The scope's own boolean is NOT the verdict — same reason the save path judges the settled
   * snapshot instead: a host refusal leaves the user layer untouched, which is precisely what a
   * structural check sees and a dropped return value does not. A throw (the settings service
   * rejecting a non-volatile path) used to escape as an unhandled rejection.
   */
  const reset = (field: string): void => {
    setClearing(field)
    setError('')
    setNote('')
    void (async () => {
      let accepted: boolean
      try {
        accepted = await clear(fieldKeyOf(namespace, { id: field } as ClientParamField))
      } catch (caught) {
        setClearing(null)
        setError(caught instanceof Error && caught.message !== '' ? caught.message : t('resetRefused'))
        return
      }
      setPending({ accepted, resets: true, field })
    })()
  }
  const save = (): void => {
    setBusy(true)
    setError('')
    setNote('')
    void (async () => {
      try {
        // T5-01/A56: EVERY dirty field travels in ONE call. The old loop sent one write per field,
        // which the Plugins page fenced with the render-time revision — the second field was then
        // refused by the host and its change silently did not land.
        const ops: SettingsParamOp[] = dirty.map(field => ({ op: 'set', path: [keyOf(field)], value: parseFor(field.control, textOf(field)) }))
        const result = saveOnce === undefined
          ? { written: await mutateOnce(ops), readback: 'ok' as const }
          : await saveOnce(ops)
        setPending({ accepted: result.written && result.readback === 'ok', readbackFailed: result.written && result.readback === 'failed', ...(result.kind === undefined ? {} : { kind: result.kind }), resets: false })
      } catch (caught) {
        // Transport-level failures (and any future shell that rejects): keep the draft
        // so nothing the operator typed is lost.
        setBusy(false)
        setError(caught instanceof Error && caught.message !== '' ? caught.message : t('refused'))
      }
    })()
  }
  return createElement('section', { className: 'evolution-param-card', 'data-card': 'params' },
    createElement('button', {
      type: 'button',
      className: 'evolution-param-head',
      'aria-expanded': open ? 'true' : 'false',
      onClick: () => { setOpen(!open) },
    },
    createElement('span', { className: 'evolution-param-card-title' }, title),
    changed === 0 ? null : createElement('span', { className: 'evolution-param-count' }, t('changed', { n: changed })),
    createElement('span', { className: 'evolution-param-chevron' }, open ? '▲' : '▼'),
    ),
    open
      ? createElement('div', { className: 'evolution-param-body' },
        hintKey === undefined ? null : createElement('p', { className: 'evolution-param-note' }, t(hintKey)),
        snapshot.stale === true ? createElement('p', { className: 'evolution-param-note', role: 'status', 'data-role': 'stale-note' }, t('readbackStale')) : null,
        disabled ? createElement('p', { className: 'evolution-param-note', role: 'status' }, t('readonly')) : null,
        fields.length === 0
          ? createElement('p', { className: 'evolution-param-note', role: 'status' }, t('empty'))
          // U-3: the generated table already carries `group`; it was never rendered. One heading per
          // distinct group (the table is ordered, so a change of group is the whole rule).
          : fields.flatMap((field, index) => [
            index === 0 || fields[index - 1]?.group !== field.group
              ? createElement('h3', { key: 'group-' + field.group, className: 'evolution-param-group' }, groupOf(field, lang))
              : null,
            createElement(FieldBlock, {
              key: field.id,
              field,
              lang,
              text: textOf(field),
              overridden: Object.hasOwn(user, keyOf(field)),
              disabled: locked,
              clearing: clearing === field.id,
              // U-5: primitives only — a nested object is not a reader-facing value.
              resetTo: resetToOf(snapshot.base?.[keyOf(field)]),
              invalid: invalidText(field),
              t,
              onChange: change,
              onClear: reset,
            }),
          ]),
        fields.length === 0 ? null : createElement('div', { className: 'evolution-param-footer' },
          error === '' && note === '' ? null : createElement('div', { className: 'evolution-param-feedback' },
            error === '' ? null : createElement('p', { className: 'evolution-param-error', role: 'status' }, error),
            note === '' ? null : createElement('p', { className: 'evolution-param-note', role: 'status' }, note),
          ),
          createElement('div', { className: 'evolution-param-footer-actions' },
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
            disabled: locked || blocked || dirty.length === 0,
            onClick: save,
          }, busy ? t('saving') : t('apply')),
          ),
        ),
      )
      : null,
  )
}

/**
 * The card as our own section renders it: the row state comes from the hook seat the
 * renderer binds out of the inject face's `hooks` compartment (components never hold a
 * subscription of their own).
 * @param props - the card data, its callbacks, and the bound row hook.
 * @returns the card.
 */
/**
 * Platform card-face wrapper: `settings.plugin.item` injects the face but does NOT bind
 * the `use<Name>` hook compartment, so this component owns the one stable external-store
 * subscription the section card gets from its renderer.
 * @param props - the injected card face.
 * @returns the card with its live row snapshot.
 */
const MISSING_SNAPSHOT = { status: 'unavailable' as const, value: undefined, user: undefined, writable: false, base: undefined, reason: 'seat-missing' as const }
const MISSING_SOURCE: ParamSectionSource = { getSnapshot: () => MISSING_SNAPSHOT, subscribe: () => () => {}, revive: () => {} }

export function PluginParamCard(props: ParamCardFace): ReactNode {
  const source = (props as { hooks?: { paramSection?: ParamSectionSource } }).hooks?.paramSection ?? MISSING_SOURCE
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  return ParamCardView({
    namespace: props.namespace,
    fields: props.fields,
    t: props.t,
    ...(props.lang === undefined ? {} : { lang: props.lang }),
    mutateOnce: props.mutateOnce,
    ...(props.saveOnce === undefined ? {} : { saveOnce: props.saveOnce }),
    clear: props.clear,
    snapshot,
  })
}

export function ParamCard(props: ParamCardProps): ReactNode {
  return ParamCardView({
    namespace: props.namespace,
    fields: props.fields,
    t: props.t,
    ...(props.lang === undefined ? {} : { lang: props.lang }),
    mutateOnce: props.mutateOnce,
    ...(props.saveOnce === undefined ? {} : { saveOnce: props.saveOnce }),
    clear: props.clear,
    snapshot: props.useParamSection((state: ParamSectionSnapshot) => state),
  })
}

