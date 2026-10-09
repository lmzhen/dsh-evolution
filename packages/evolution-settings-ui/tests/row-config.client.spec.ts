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

/** Find one control by its rendered label (the reset pair changes label while it is in flight). */
function findButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(button => button.textContent === label)
}

/** The row's reset control, by the label it wears at rest. */
function resetButton(container: HTMLElement): Element {
  const button = findButton(container, t('reset'))
  if (button === undefined) throw new Error('the row rendered no reset control')
  return button
}

/** One page-side state, as `formFor()` builds it from the settings seat. */
function state(user: Record<string, unknown>): Record<string, unknown> {
  return { status: 'ready', value: { ...user }, base: undefined, user, revision: 7, writable: true, mode: 'host' }
}

describe('the per-row configuration entry', () => {
  it('T5-01/A56: a TWO-field save is ONE fenced write carrying both ops (the second field no longer vanishes)', async () => {
    const mutate = vi.fn(async () => true)
    const second = fields.filter(field => field.control === 'number')[1]
    if (second === undefined) throw new Error('the memory-files row lost its second numeric field')
    const view = render(card({ view: 'page', form: { state: state({}), mutate } }))
    fireEvent.click(view.container.querySelector('.evolution-param-head') as Element)
    for (const [field, value] of [[NUMBER_FIELD, '321'], [second, '654']] as const) {
      const input = view.container.querySelector('#' + 'evolution-param-' + field.id) as HTMLInputElement
      fireEvent.change(input, { target: { value } })
    }
    fireEvent.click(view.container.querySelector('[data-primary="true"]') as Element)
    await vi.waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    // ONE call, both fields, the revision this render read. Before T5-01 the save looped per field and
    // every call carried the SAME render-time revision, so the host refused the second one
    // (SettingsConflictError → recovered to false) and that field's change silently did not land.
    expect(mutate.mock.calls[0]?.[0]).toEqual([
      { op: 'set', path: [NUMBER_FIELD.id], value: 321 },
      { op: 'set', path: [second.id], value: 654 },
    ])
    expect(mutate.mock.calls[0]?.[1]).toBe(7)
    cleanup()
  })

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

  it('audit T5-05/A60: a refused reset says so instead of silently doing nothing', async () => {
    // The host refuses the unset (a non-volatile path throws, a conflicting write answers false) and
    // the page state therefore still holds the override. Before this verdict the click changed
    // NOTHING on screen: the row kept its "edited by you" chip and the reader concluded the button
    // was broken.
    const mutate = vi.fn(async () => true)
    const view = render(card({ view: 'page', form: { state: state({ [NUMBER_FIELD.id]: 200 }), mutate } }))
    fireEvent.click(view.container.querySelector('.evolution-param-head') as Element)
    fireEvent.click(resetButton(view.container))
    await vi.waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    // The page's own op list for a reset — one unset for that path, with the revision it read.
    expect(mutate.mock.calls[0]?.[0]).toEqual([{ op: 'unset', path: [NUMBER_FIELD.id] }])
    expect(mutate.mock.calls[0]?.[1]).toBe(7)
    await vi.waitFor(() => { expect(view.container.textContent).toContain(t('resetRefused')) })
    cleanup()
  })

  it('audit T5-05/A60: a reset that lands leaves no error line, and the row drops its override', async () => {
    const mutate = vi.fn(async () => true)
    const view = render(card({ view: 'page', form: { state: state({ [NUMBER_FIELD.id]: 200 }), mutate } }))
    fireEvent.click(view.container.querySelector('.evolution-param-head') as Element)
    fireEvent.click(resetButton(view.container))
    await vi.waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    // The page re-renders the entry from its own state — the override is gone, which is the evidence
    // the verdict reads. Same op list, opposite verdict: the check is structural.
    view.rerender(card({ view: 'page', form: { state: state({}), mutate } }))
    await vi.waitFor(() => { expect(view.container.textContent).not.toContain(t('resetRefused')) })
    expect(findButton(view.container, t('reset'))).toBeUndefined()
    cleanup()
  })

  it('audit T5-05/A60: the reset control reports an in-flight reset and locks the card', async () => {
    let release: (() => void) | null = null
    const hold = new Promise<void>((resolve) => { release = resolve })
    const mutate = vi.fn(async () => { await hold; return true })
    const view = render(card({ view: 'page', form: { state: state({ [NUMBER_FIELD.id]: 200 }), mutate } }))
    fireEvent.click(view.container.querySelector('.evolution-param-head') as Element)
    fireEvent.click(resetButton(view.container))
    await vi.waitFor(() => { expect(findButton(view.container, t('resetting'))).toBeDefined() })
    expect((view.container.querySelector('[data-primary="true"]') as HTMLButtonElement).disabled).toBe(true)
    release?.()
    await vi.waitFor(() => { expect(findButton(view.container, t('resetting'))).toBeUndefined() })
    cleanup()
  })

  it('audit T5-05/A60: a throwing settings service reaches the reader instead of escaping', async () => {
    const mutate = vi.fn(async () => { throw new Error('this path is not volatile') })
    const view = render(card({ view: 'page', form: { state: state({ [NUMBER_FIELD.id]: 200 }), mutate } }))
    fireEvent.click(view.container.querySelector('.evolution-param-head') as Element)
    fireEvent.click(resetButton(view.container))
    await vi.waitFor(() => { expect(view.container.textContent).toContain('this path is not volatile') })
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
