// @tier ci-only
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { DISCOVERY_AWARENESS, installDiscoveryAwareness } from '../src/index.ts'

it('registers a static 1-2 sentence awareness in the real system prompt', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  installDiscoveryAwareness(ctx)
  const assembly = await ctx.systemPrompt.assemble()
  const prompt = renderPrompt(assembly)
  expect(prompt).toContain(DISCOVERY_AWARENESS)
  expect(DISCOVERY_AWARENESS).not.toContain('<')
  expect(DISCOVERY_AWARENESS.split('.').filter(Boolean).length).toBeLessThanOrEqual(2)
})
