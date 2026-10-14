// @tier pre-tag
// @vitest-environment jsdom
/**
 * U-5 (G5.7): the three decision facts the seat already knows, put on screen. `base` and `mode` are
 * declared by the platform snapshot and were simply DROPPED by the card's projection, so a reader could
 * not tell where the value they see comes from, where a save goes, or what "restore default" would
 * restore. The two judges below are the ones the UI seat asked for on this half.
 */
import { describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { createElement } from 'react'
import { CLIENT_PARAM_SECTIONS } from '../src/client/generated-params.ts'
import { formatText, type MessageKey } from '../src/client/messages.ts'
import { RowConfigCard } from '../src/client/RowConfigCard.ts'

const t = (key: MessageKey, values?: Readonly<Record<string, string | number>>): string => formatText(key, values)
const section = CLIENT_PARAM_SECTIONS.find(candidate => candidate.namespace === 'evolution-curator')
if (section === undefined) throw new Error('the generated view lost the curator row')
const fields = section.fields
const FIELD = fields[0]!
const h = createElement as unknown as (type: unknown, props: unknown) => Parameters<typeof render>[0]

function page(options: { user?: Record<string, unknown>; base?: Record<string, unknown>; mode?: 'host' | 'memory' }) {
  const user = options.user ?? {}
  const base = options.base ?? {}
  const state = { status: 'ready', value: { ...base, ...user }, base, user, revision: 7, writable: true, mode: options.mode ?? 'host' }
  const view = render(h(RowConfigCard, { namespace: 'evolution-curator', fields, t, view: 'page', form: { state, mutate: async () => true } }))
  fireEvent.click(view.container.querySelector('.evolution-param-head') as Element)
  return view
}

describe('U-5: where the value comes from, and where a save goes', () => {
  it('says a memory-mode row is this session only, and never reads as a refusal', () => {
    const view = page({ mode: 'memory' })
    expect(view.container.textContent).toContain(t('destMemory'))
    expect(view.container.textContent).not.toContain(t('refused'))
    cleanup()
  })

  it('names the value a reset would restore (the seat base)', () => {
    const view = page({ base: { [FIELD.id]: 42 }, user: { [FIELD.id]: 7 } })
    expect(view.container.textContent).toContain(t('resetTo', { value: 42 }))
    cleanup()
  })
})
