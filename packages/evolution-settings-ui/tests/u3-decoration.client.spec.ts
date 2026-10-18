// @tier pre-tag
// @vitest-environment jsdom
/**
 * U-3 (G5.4): decoration is only rendered when it carries information. The row used to print one
 * chip PER FIELD (writing "deployment default" for the ten fields nobody touched), and the generated
 * table's `group` column was never rendered at all. The judges here are the ones the UI seat asked
 * for: rendered chips === covered fields, and one heading per distinct group.
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
const h = createElement as unknown as (type: unknown, props: unknown) => Parameters<typeof render>[0]

function page(user: Record<string, unknown>) {
  const state = { status: 'ready', value: { ...user }, base: undefined, user, revision: 7, writable: true }
  const view = render(h(RowConfigCard, { namespace: 'evolution-curator', fields, t, view: 'page', form: { state, mutate: async () => true } }))
  fireEvent.click(view.container.querySelector('.evolution-param-head') as Element)
  return view
}

describe('U-3: decoration only when it carries information', () => {
  it('a ZERO-coverage row renders no field chip at all', () => {
    const view = page({})
    expect(fields.length).toBeGreaterThan(8) // the 11-field row this finding was measured on
    expect(view.container.querySelectorAll('.evolution-param-source')).toHaveLength(0)
    cleanup()
  })

  it('the chip count equals the number of COVERED fields', () => {
    const covered = { [fields[0]!.id]: 5, [fields[1]!.id]: 6 }
    const view = page(covered)
    expect(view.container.querySelectorAll('.evolution-param-source')).toHaveLength(2)
    cleanup()
  })

  it('draws one heading per distinct generated group', () => {
    const view = page({})
    const headings = [...view.container.querySelectorAll('.evolution-param-group')].map(node => node.textContent)
    expect(headings).toEqual([...new Set(fields.map(field => field.group))])
    cleanup()
  })
})
