// @tier ci-only
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { executeOne, mountToolHost } from './tool-host.ts'

it('mounts the target native executor and runs one tool through executeOne', async () => {
  const ctx = new Context()
  await mountToolHost(ctx, { executor: 'native' })
  ctx.tools.register(defineTool({
    name: 'host-smoke',
    description: 'echo input',
    parameters: { text: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async args => args.text,
  }))
  const result = await executeOne(ctx, { name: 'host-smoke', arguments: { text: 'ok' } })
  expect(result.isError).toBe(false)
  expect(JSON.stringify(result.content)).toContain('ok')
})
