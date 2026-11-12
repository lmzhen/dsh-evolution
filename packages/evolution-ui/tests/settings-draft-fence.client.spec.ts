// @tier pre-tag
// @vitest-environment jsdom
/**
 * W9-g6 drill: the save fence must be the revision the DRAFT began at, not the newest rendering.
 *
 * The card subscribes to the row, so another editor's write re-renders it and advances the revision
 * between the first keystroke and the click. Passing the click-time revision made the Host's CAS
 * succeed by construction: the draft silently replaced a value the operator never saw.
 */
import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { createElement } from 'react'
import { CLIENT_PARAM_SECTIONS } from '../src/panels/settings/generated-params.ts'
import { formatText, type MessageKey } from '../src/panels/settings/messages.ts'
import { RowConfigCard } from './helpers/RowConfigCard.ts'

const t = (key: MessageKey, values?: Readonly<Record<string, string | number>>): string => formatText(key, values)
const section = CLIENT_PARAM_SECTIONS.find(candidate => candidate.namespace === 'memory-files')
if (section === undefined) throw new Error('the generated view lost the memory-files row')
const fields = section.fields
const FIELD = fields.find(field => field.control === 'number')
expect(FIELD?.id).toBe('memoryChars')
if (FIELD === undefined) throw new Error('the memory-files row lost its numeric fields')

const h = createElement as unknown as (type: unknown, props: unknown) => Parameters<typeof render>[0]

function state(revision: number) {
  return { status: 'ready', value: {}, base: undefined, user: {}, revision, writable: true }
}

const card = (mutate: unknown, revision: number) =>
  h(RowConfigCard, { namespace: 'memory-files', fields, t, view: 'page', form: { state: state(revision), mutate } })

function open(view: ReturnType<typeof render>): void {
  fireEvent.click(view.container.querySelector('.evolution-param-head') as Element)
}

function type(view: ReturnType<typeof render>, text: string): void {
  const input = view.container.querySelector('#' + 'evolution-param-' + FIELD.id) as HTMLInputElement
  fireEvent.change(input, { target: { value: text } })
}

describe('the save fence is the draft baseline (W9-g6)', () => {
  it('keeps the revision the draft began at when the row advanced meanwhile', async () => {
    const mutate = vi.fn(async () => true)
    const view = render(card(mutate, 7))
    open(view)
    type(view, '321')
    // Someone else wrote: the subscription re-renders this card with a newer revision.
    view.rerender(card(mutate, 8))
    fireEvent.click(view.container.querySelector('[data-primary="true"]') as Element)
    await vi.waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]?.[1]).toBe(7)
    cleanup()
  })

  it('re-baselines after a settled write', async () => {
    const mutate = vi.fn(async () => true)
    const view = render(card(mutate, 7))
    open(view)
    type(view, '321')
    fireEvent.click(view.container.querySelector('[data-primary="true"]') as Element)
    await vi.waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    // Wait for the card to settle (the controls unlock only after the write's verdict is in).
    await vi.waitFor(() => { expect(view.container.textContent).toContain(t('saved')) })
    // The host accepted and moved the row to 8: the NEXT draft starts from the settled revision.
    view.rerender(card(mutate, 8))
    type(view, '322')
    fireEvent.click(view.container.querySelector('[data-primary="true"]') as Element)
    await vi.waitFor(() => { expect(mutate).toHaveBeenCalledTimes(2) })
    expect(mutate.mock.calls[1]?.[1]).toBe(8)
    cleanup()
  })
})
