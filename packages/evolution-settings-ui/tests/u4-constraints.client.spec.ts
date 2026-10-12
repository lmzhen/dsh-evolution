// @vitest-environment jsdom
/**
 * U-4 (G5.8): constraint-first, scoped to what is REACHABLE — the finding from ③ is worth more than
 * the fix: the controls constrain their own domains (a number input sanitizes illegal text, a select
 * only offers listed values, jsdom does the same), so an illegal value CANNOT reach the DOM through
 * these controls at all. The reachable surface is therefore the rule itself plus the card's
 * defensive wiring; the host-side refusal sentence is judged in `refused-verdict.client.spec.ts`.
 *
 * What is pinned here: the rule (unit level, the inputs a snapshot really can carry) and the
 * non-vacuity anchor — a card with acceptable values still saves in ONE call.
 */
import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { createElement } from 'react'
import { CLIENT_PARAM_SECTIONS } from '../src/client/generated-params.ts'
import { formatText, type MessageKey } from '../src/client/messages.ts'
import { RowConfigCard } from '../src/client/RowConfigCard.ts'
import { invalidReason } from '../src/client/ParamCard.ts'

const t = (key: MessageKey, values?: Readonly<Record<string, string | number>>): string => formatText(key, values)
const h = createElement as unknown as (type: unknown, props: unknown) => Parameters<typeof render>[0]

const section = CLIENT_PARAM_SECTIONS.find(candidate =>
  candidate.fields.some(field => field.control === 'select') && candidate.fields.some(field => field.control === 'number'))
if (section === undefined) throw new Error('no generated row carries both a select and a number field')
const fields = section.fields
const SELECT = fields.find(field => field.control === 'select')!
const NUMBER = fields.find(field => field.control === 'number')!
// A shape pick alone silently re-points when the registry grows (independent review P2-9): this file
// is about THESE two fields, so it says so. If the data legitimately moves, this line is the notice.
expect(SELECT.id).toBe('approvalConfirm')
expect(NUMBER.id).toBe('evolution-approval.pendingTtlMs')

describe('U-4: what the card accepts, and what it refuses to stage', () => {
  it('U-4: the cross-field column refuses the pair the Host would refuse (E-322 before the fact)', () => {
    // The relation is read from the GENERATED view, not spelled here: removing the registry column
    // (gen-param-client-view) must redden this case, which is what makes it a proof that the card
    // reads the declared column rather than a constant of its own.
    const related = CLIENT_PARAM_SECTIONS.flatMap(candidate => candidate.fields).find(field => field.atLeast !== '')
    expect(related, 'no generated field declares a relation — has the registry column been dropped?').toBeDefined()
    const field = related!
    expect(invalidReason(field, '45', '60')).toBe('invalidAtLeast')
    // Equal to the floor is legal, and so is anything above it.
    expect(invalidReason(field, '60', '60')).toBe(null)
    expect(invalidReason(field, '90', '60')).toBe(null)
    // A card that cannot see the sibling row must NOT invent a refusal — the Host still enforces it.
    expect(invalidReason(field, '45', undefined)).toBe(null)
  })

  it('names the refusal for a value outside the registry, and accepts the listed ones', () => {
    expect(invalidReason(SELECT, SELECT.values[0] ?? 'x')).toBeNull()
    expect(invalidReason(SELECT, 'legacy-mode')).toBe('invalidSelect')
    expect(invalidReason(NUMBER, '9')).toBeNull()
    expect(invalidReason(NUMBER, 'not-a-number')).toBe('invalidNumber')
    expect(invalidReason(NUMBER, '')).toBeNull() // an empty control is "unset", not invalid
  })

  it('RENDERS the refusal sentence for an invalid value instead of crashing (independent review P1-1)', () => {
    // The crash this pins: the explanation node referred to a local that only existed inside the
    // control, so ANY invalid value threw ReferenceError while the fixture stayed green — it only
    // ever rendered acceptable values. This case walks the branch that used to throw.
    const mutate = vi.fn(async () => true)
    const state = {
      // BOTH maps carry it: `value` is what the control renders, `user` is what marks it overridden.
      status: 'ready', value: { [SELECT.id]: 'legacy-mode' }, base: {}, revision: 7, writable: true, mode: 'host',
      user: { [SELECT.id]: 'legacy-mode' },
    }
    const view = render(h(RowConfigCard, { namespace: section!.namespace, fields, t, view: 'page', form: { state, mutate } }))
    fireEvent.click(view.container.querySelector('.evolution-param-head') as Element)
    // The sentence is there, and it is the one the rule names.
    const sentence = view.container.querySelector('.evolution-param-error')
    expect(sentence).not.toBeNull()
    expect(sentence!.textContent).toBe(formatText('invalidSelect'))
    // The control points AT that sentence, through the id the control and the node now share.
    const control = view.container.querySelector('[id="evolution-param-' + SELECT.id + '"]') as HTMLElement
    expect(control.getAttribute('aria-invalid')).toBe('true')
    expect(control.getAttribute('aria-describedby')).toBe(sentence!.getAttribute('id'))
    // And an unacceptable value is never staged: the save is blocked, the host is not called.
    const save = view.container.querySelector('[data-primary="true"]') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(save)
    expect(mutate).not.toHaveBeenCalled()
    cleanup()
  })

  it('a card with acceptable values still saves in ONE call (the anchor)', () => {
    const mutate = vi.fn(async () => true)
    const state = { status: 'ready', value: {}, base: {}, user: {}, revision: 7, writable: true, mode: 'host' }
    const view = render(h(RowConfigCard, { namespace: section!.namespace, fields, t, view: 'page', form: { state, mutate } }))
    fireEvent.click(view.container.querySelector('.evolution-param-head') as Element)
    fireEvent.change(view.container.querySelector('[id="evolution-param-' + NUMBER.id + '"]') as HTMLElement, { target: { value: '9' } })
    const save = view.container.querySelector('[data-primary="true"]') as HTMLButtonElement
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    expect(mutate).toHaveBeenCalledTimes(1)
    cleanup()
  })
})
