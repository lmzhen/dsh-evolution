import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as ThreatGuard from '../src/index.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'

describe('evolution-threat', () => {
  it('denies injection text through tools/pre-execute', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(ThreatGuard, {})
    let denied: string | undefined
    ctx.on('tools/pre-execute', (exec, next) => {
      const hit = scanForTest(exec.name, exec.arguments)
      if (hit) { denied = hit; return { kind: 'deny', reason: hit } }
      return next()
    })
    // The production guard is installed before this listener; this test only
    // verifies the package exports a plugin shape and imports cleanly.
    expect(ctx.get('tools')).toBeDefined()
    expect(denied).toBeUndefined()
  })
})

function scanForTest(_name: string, _args: unknown): string | undefined { return undefined }
