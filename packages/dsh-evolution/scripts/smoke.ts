/**
 * Out-of-tree runtime smoke test.
 * Run from the DeepSeek Harness repo so its tsconfig path map resolves
 * `@deepseek-ai/*` to source:
 *   cd D:/dsh/deepseek-harness
 *   node_modules/.bin/tsx file:///D:/dsh/dsh-evolution/scripts/smoke.ts
 */
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as Evolution from '../src/index.ts'

const ctx = new Context()
await mountAgentLoopTestDependencies(ctx)
await ctx.plugin(Evolution, { reviewEnabled: false, curatorEnabled: false })

if (!ctx.tools.get('memory')) throw new Error('memory tool missing')
if (!ctx.tools.get('skill_manage')) throw new Error('skill_manage tool missing')

const assembly = await ctx.systemPrompt.assemble({})
const text = assembly.sections.map(section => section.text).join('\n')
if (!text.includes('Hermes Evolution')) throw new Error('guidance section missing')

console.log('smoke: memory tool OK')
console.log('smoke: skill_manage tool OK')
console.log('smoke: system prompt guidance OK')
