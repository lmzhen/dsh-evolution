// @vitest-environment jsdom
/**
 * The Plugins page's per-row configuration entry (G2).
 *
 * The page owns the subscription and passes the row's form in, so this entry renders the
 * SHARED card body from `form.state` and writes through `form.mutate` — a second render
 * site for one component. Three things are pinned here: the summary view stays empty for an
 * untouched row (the page then keeps the row's own description), the page view renders the
 * row's controls and submits one edit as the page's own op list, and a deployment with no
 * settings seat says so instead of drawing controls that cannot be saved.
 */
import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { createElement } from 'react'
import { CLIENT_PARAM_SECTIONS } from '../src/client/generated-params.ts'
import { message, type MessageKey } from '../src/client/messages.ts'
import { RowConfigCard } from '../src/client/RowConfigCard.ts'

/**
 * `createElement` narrowed for the renderer: this package carries its own minimal ambient
 * React surface, so the element type the renderer wants is spelled here, once (same
 * narrowing as the section spec).
 */
const h = createElement as unknown as (type: unknown, props: unknown) => Parameters<typeof render>[0]

/** The bundle's own copy, so the assertions read the same text the operator does. */
const t = (key: MessageKey): string => message(key)

const section = CLIENT_PARAM_SECTIONS.find(candidate => candidate.namespace === 'memory-files')
if (section === undefined) throw new Error('the generated view lost the memory-files row')
const fields = section.fields
/** A numeric field, so one edit's parse rule is unambiguous. */
const NUMBER_FIELD = fields.find(field => field.control === 'number')
if (NUMBER_FIELD === undefined) throw new Error('the memory-files row lost its numeric fields')

/** One row entry, rendered with the page's view/form seat. */
function card(props: Record<string, unknown>): Parameters<typeof render>[0] {
  return h(RowConfigCard, { namespace: 'memory-files', fields, t, ...props })
}

/** One page-side state, as `formFor()` builds it from the settings seat. */
function state(user: Record<string, unknown>): Record<string, unknown> {
  return { status: 'ready', value: { ...user }, base: undefined, user, revision: 7, writable: true, mode: 'host' }
}

describe('the per-row configuration entry', () => {
  it('summarises the overridden count, and renders nothing for an untouched row', () => {
    const touched = render(card({ view: 'summary', form: { state: state({ [NUMBER_FIELD.id]: 200 }), mutate: async () => true } }))
    expect(touched.container.textContent).toBe(t('changed').replace('{n}', '1'))
    cleanup()
    const untouched = render(card({ view: 'summary', form: { state: state({}), mutate: async () => true } }))
    expect(untouched.container.textContent).toBe('')
    cleanup()
  })

  it('renders the row from the page state and submits the edit through mutate', async () => {
    const mutate = vi.fn(async () => true)
    const view = render(card({ view: 'page', form: { state: state({}), mutate } }))
    // The card opens collapsed, exactly as it does in our own section.
    fireEvent.click(view.container.querySelector('.evolution-param-head') as Element)
    const input = view.container.querySelector('#' + 'evolution-param-' + NUMBER_FIELD.id) as HTMLInputElement
    expect(input).not.toBeNull()
    fireEvent.change(input, { target: { value: '321' } })
    fireEvent.click(view.container.querySelector('[data-primary="true"]') as Element)
    await vi.waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    // The page's own op list, fenced with the revision the entry read — not a bare set().
    expect(mutate.mock.calls[0]?.[0]).toEqual([{ op: 'set', path: [NUMBER_FIELD.id], value: 321 }])
    expect(mutate.mock.calls[0]?.[1]).toBe(7)
    cleanup()
  })

  it('states the missing settings seat instead of drawing dead controls', () => {
    const page = render(card({ view: 'page' }))
    expect(page.container.textContent).toBe(t('seatMissing'))
    cleanup()
    const summary = render(card({ view: 'summary' }))
    expect(summary.container.textContent).toBe('')
    cleanup()
  })
})
