// @tier ci-only
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { executeOne, mountToolHost } from '../../test-support/tool-host.ts'
import { registerSkillSearchTool } from '../src/index.ts'

it('registers skill_search with the static schema and executes provider results', async () => {
  const ctx = new Context()
  await mountToolHost(ctx)
  await ctx.plugin(Object.assign((inner: Context) => {
    registerSkillSearchTool(inner, { search: async ({ query }) => ({ results: [{ name: query, description: 'found' }], truncated: false }) })
  }, { inject: ['tools'] }))
  const result = await executeOne(ctx, { signal: new AbortController().signal, callId: ToolCallId('search-1'), name: 'skill_search', arguments: { query: 'alpha' } })
  expect(result.isError).toBe(false)
  expect(JSON.stringify(result.content)).toContain('alpha')
  const tools = ctx.get('tools')!
  const input = tools.get('skill_search')?.parameters as { properties?: Record<string, unknown> }
  expect(Object.keys(input.properties ?? {})).toEqual(['query', 'limit'])
})


it('passes a current-view allowed set into the search provider', async () => {
  const ctx = new Context()
  await mountToolHost(ctx)
  await ctx.plugin(Object.assign((inner: Context) => {
    registerSkillSearchTool(inner, {
      allowedSkillKeys: () => new Set(['alpha']),
      search: async (_query, options) => ({ results: [{ name: 'alpha', description: 'a' }, { name: 'beta', description: 'b' }].filter(hit => options?.allowedSkillKeys?.has(hit.name)), truncated: false }),
    })
  }, { inject: ['tools'] }))
  const result = await executeOne(ctx, { signal: new AbortController().signal, callId: ToolCallId('search-2'), name: 'skill_search', arguments: { query: 'x' } })
  expect(JSON.stringify(result.content)).toContain('alpha')
  expect(JSON.stringify(result.content)).not.toContain('beta')
})

