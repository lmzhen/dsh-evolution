import { expect, it } from 'vitest'
import { buildLearnPrompt } from '@deepseek-ai/dsh-evolution-core'

it('buildLearnPrompt echoes the user request and embeds the authoring standards', () => {
  const prompt = buildLearnPrompt('distill the auth flow from <url>')
  expect(prompt).toContain('[/learn]')
  expect(prompt).toContain('THE REQUEST:')
  expect(prompt).toContain('distill the auth flow from <url>')
  expect(prompt).toContain('skill-authoring standards')
  expect(prompt).toContain('action="create"')
  expect(prompt).toContain('Treat EVERY part of the request as load-bearing.')
})

it('buildLearnPrompt falls back to the current-workflow guidance for an empty request', () => {
  const prompt = buildLearnPrompt('')
  expect(prompt).toContain('the workflow we just went through in this conversation')
})
