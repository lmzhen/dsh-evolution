import { expect, it } from 'vitest'
import { buildLearnPrompt } from '@deepseek-ai/dsh-evolution-core'

it('buildLearnPrompt echoes the user request and points at the authoring standards', () => {
  const prompt = buildLearnPrompt('distill the auth flow from <url>')
  expect(prompt).toContain('[/learn]')
  expect(prompt).toContain('THE REQUEST:')
  expect(prompt).toContain('distill the auth flow from <url>')
  expect(prompt).toContain('skill-authoring standards')
  expect(prompt).toContain('action="create"')
  expect(prompt).toContain('Treat EVERY part of the request as load-bearing.')
  // P2-25 (v39): the standards body lives in the `skill_manage` description
  // only; embedding it here repeated 1840 chars on every /learn turn.
  expect(prompt).not.toContain('Follow the Hermes skill-authoring standards')
  expect(prompt.length).toBeLessThan(2000)
})

it('buildLearnPrompt falls back to the current-workflow guidance for an empty request', () => {
  const prompt = buildLearnPrompt('')
  expect(prompt).toContain('the workflow we just went through in this conversation')
})
