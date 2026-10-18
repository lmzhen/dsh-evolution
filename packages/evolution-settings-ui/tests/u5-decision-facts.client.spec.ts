// @tier pre-tag
// @vitest-environment jsdom
/**
 * G5/W7 S5: the decision facts the card shows after the platform `mode` was retired.
 *
 * The family has ONE write target — the host configuration, for every session — so the card states
 * it as a fixed line instead of modelling a session-memory mode. `base` is still the seat fact a
 * "restore default" names, and an unavailable row keeps saying it is not served (it is no longer
 * excused as "session memory").
 */
import { describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { createElement } from 'react'
import { CLIENT_PARAM_SECTIONS } from '../src/client/generated-params.ts'
import { formatText, type MessageKey } from '../src/client/messages.ts'
import { RowConfigCard } from '../src/client/RowConfigCard.ts'
import { sectionSnapshotOf } from '../src/client/source.ts'

const t = (key: MessageKey, values?: Readonly<Record<string, string | number>>): string => formatText(key, values)
const section = CLIENT_PARAM_SECTIONS.find(candidate => candidate.namespace === 'evolution-curator')
if (section === undefined) throw new Error('the generated view lost the curator row')
const fields = section.fields
const FIELD = fields[0]!
const h = createElement as unknown as (type: unknown, props: unknown) => Parameters<typeof render>[0]

function page(options: { user?: Record<string, unknown>; base?: Record<string, unknown>; status?: 'ready' | 'unavailable' } = {}) {
  const user = options.user ?? {}
  const base = options.base ?? {}
  const state = { status: options.status ?? 'ready', value: { ...base, ...user }, base, user, revision: 7, writable: true }
  const view = render(h(RowConfigCard, { namespace: 'evolution-curator', fields, t, view: 'page', form: { state, mutate: async () => true } }))
  fireEvent.click(view.container.querySelector('.evolution-param-head') as Element)
  return view
}

describe('U-5/S5: where the value comes from, and where a save goes', () => {
  it('states the ONE write target on every render — host configuration, all sessions — and never as a refusal', () => {
    const view = page()
    expect(view.container.textContent).toContain(t('writeTargetHost'))
    expect(view.container.textContent).not.toContain(t('refused'))
    cleanup()
  })

  it('works on a snapshot without any mode field (the platform fact is gone, the write face is not)', () => {
    const view = page({ user: { [FIELD.id]: 'x' } })
    expect(view.container.textContent).toContain(t('writeTargetHost'))
    cleanup()
  })

  it('an unavailable row is not-served, never excused as session memory', () => {
    const snap = { status: 'unavailable' } as unknown as Parameters<typeof sectionSnapshotOf>[0]
    expect(sectionSnapshotOf(snap).reason).toBe('not-served')
  })

  it('names the value a reset would restore (the seat base)', () => {
    const view = page({ base: { [FIELD.id]: 42 }, user: { [FIELD.id]: 7 } })
    expect(view.container.textContent).toContain(t('resetTo', { value: 42 }))
    cleanup()
  })
})
