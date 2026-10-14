// @tier fast
// @vitest-environment jsdom
/**
 * G5 P1-1 drill: a REFUSED write whose value already matches the on-screen state must still read as
 * refused. The old verdict compared the settled user layer against the requested values, so this exact
 * case (the Host refused, the value was already there — a concurrent editor or a pre-existing override)
 * was reported as a successful save. The verdict is now the Host's own boolean, so this goes red on any
 * regression that goes back to comparing values.
 */
import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { createElement } from 'react'
import { CLIENT_PARAM_SECTIONS } from '../src/client/generated-params.ts'
import { formatText, type MessageKey } from '../src/client/messages.ts'
import { RowConfigCard } from '../src/client/RowConfigCard.ts'

const t = (key: MessageKey, values?: Readonly<Record<string, string | number>>): string => formatText(key, values)
const section = CLIENT_PARAM_SECTIONS.find(candidate => candidate.namespace === 'memory-files')
if (section === undefined) throw new Error('the generated view lost the memory-files row')
const fields = section.fields
const FIELD = fields.find(field => field.control === 'number')
// Named, not just shaped: a shape pick re-points silently when the section grows (P2-9).
expect(FIELD?.id).toBe('memoryChars')
if (FIELD === undefined) throw new Error('the memory-files row lost its numeric fields')

const h = createElement as unknown as (type: unknown, props: unknown) => Parameters<typeof render>[0]

/** One page-side state, as the entry's own `form` seat builds it from the settings seat. */
function state(user: Record<string, unknown>) {
  return { status: 'ready', value: { ...user }, base: undefined, user, revision: 7, writable: true, mode: 'host' }
}

const card = (mutate: unknown, user: Record<string, unknown>) =>
  h(RowConfigCard, { namespace: 'memory-files', fields, t, view: 'page', form: { state: state(user), mutate } })

describe('the refused-write verdict (G5 P1-1)', () => {
  it('reports a refused save even when the user layer already holds the requested value', async () => {
    const mutate = vi.fn(async () => false)
    const view = render(card(mutate, { [FIELD.id]: 321 }))
    fireEvent.click(view.container.querySelector('.evolution-param-head') as Element)
    const input = view.container.querySelector('#' + 'evolution-param-' + FIELD.id) as HTMLInputElement
    // Different TEXT, same parsed value: the field counts as edited, and the post-write snapshot still
    // equals what was requested — the trap the old value-comparison verdict fell into.
    fireEvent.change(input, { target: { value: ' 321 ' } })
    fireEvent.click(view.container.querySelector('[data-primary="true"]') as Element)
    await vi.waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    await vi.waitFor(() => { expect(view.container.textContent).toContain(t('refused')) })
    cleanup()
  })

  it('forwards an ACCEPTED write through the entry (no refusal line)', async () => {
    const mutate = vi.fn(async () => true)
    const view = render(card(mutate, {}))
    fireEvent.click(view.container.querySelector('.evolution-param-head') as Element)
    const input = view.container.querySelector('#' + 'evolution-param-' + FIELD.id) as HTMLInputElement
    fireEvent.change(input, { target: { value: '321' } })
    fireEvent.click(view.container.querySelector('[data-primary="true"]') as Element)
    await vi.waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    // The entry must RETURN the Host's boolean: awaiting and dropping it makes every accepted write
    // read as refused, so this is the counterpart of the drill above.
    await vi.waitFor(() => { expect(view.container.textContent).not.toContain(t('refused')) })
    cleanup()
  })
})
