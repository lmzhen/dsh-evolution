// @tier fast
import { expect, it } from 'vitest'
import { groupParamCards } from '../src/panels/settings/settings-groups.ts'

it('groups existing namespaces by task and keeps every card once', () => {
  const cards = [
    { namespace: 'memory-files' }, { namespace: 'evolution-approval' },
    { namespace: 'evolution-curator' }, { namespace: 'evolution-merge' },
    { namespace: 'tool-skill-manage' }, { namespace: 'tool-memory' },
  ]
  const groups = groupParamCards(cards)
  expect(groups.map(group => group.group)).toEqual(['write', 'organize', 'memory'])
  expect(groups[0]?.items.map(item => item.namespace)).toEqual(['evolution-approval', 'evolution-merge', 'tool-skill-manage'])
  expect(groups.flatMap(group => group.items)).toHaveLength(cards.length)
})

it('puts an unknown namespace in organize rather than dropping it', () => {
  expect(groupParamCards([{ namespace: 'future-row' }])[0]).toMatchObject({ group: 'organize' })
})
