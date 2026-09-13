/**
 * S0.1 (v37 P0-1): prompt-variable neutralization for the memory snapshot.
 *
 * A stored memory entry containing the platform's `{{name}}` syntax used to make
 * `systemPrompt` assembly THROW on every later model step of every session under
 * the same DSH_HOME (the platform interpolates every context text and rejects an
 * unknown/malformed reference), while a registered name such as `{{cwd}}` was
 * silently substituted into the memory the model reads. The fix neutralizes the
 * INJECTED text only — the stored entry keeps its original bytes.
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { renderContextSections } from '@deepseek-ai/dsh-system-prompt'
import MemoryRegistry from '@deepseek-ai/dsh-memory'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as MemoryFiles from '@deepseek-ai/dsh-memory-files'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as ToolMemory from '../src/index.ts'
import { tempRoot } from '../../test-support/temp-home.ts'

const POISON = 'Deploy template: {{APP_NAME}} on port {{PORT}}; root {{cwd}}'

/** Mount the memory seam with the production system-prompt assembly. */
async function mountMemorySeam(root: string, withTool: boolean): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(MemoryRegistry)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(MemoryFiles, { root })
  if (withTool) await ctx.plugin(ToolMemory, {})
  return ctx
}

/** The injected snapshot text, read through the platform's own renderer. */
async function snapshotText(ctx: Context): Promise<string> {
  const assembly = await ctx.systemPrompt.assemble({})
  return renderContextSections(assembly).find(section => section.name === 'evolution:memory-snapshot')?.text ?? ''
}

describe('tool-memory · prompt-variable neutralization (S0.1, v37 P0-1)', () => {
  it('mount-time snapshot: {{...}} neither throws assembly nor reaches the model verbatim', async () => {
    const root = await tempRoot('dsh-evolution-tmp-')
    const writer = await mountMemorySeam(root, false)
    await writer.memory.applyBatch('memory', [{ action: 'add', facts: POISON }])
    const ctx = await mountMemorySeam(root, true)
    const text = await snapshotText(ctx)
    expect(text).toContain('Deploy template')
    expect(text).not.toContain('{{')
    // Registered variables must not be substituted into stored knowledge.
    expect(text).not.toContain(root)
  })

  it('refresh path: an entry written after mount is neutralized too, and the file keeps its bytes', async () => {
    const root = await tempRoot('dsh-evolution-tmp-')
    const ctx = await mountMemorySeam(root, true)
    await ctx.memory.applyBatch('memory', [{ action: 'add', facts: POISON }])
    let text = ''
    for (let attempt = 0; attempt < 50 && !text.includes('Deploy template'); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 20))
      text = await snapshotText(ctx)
    }
    expect(text).toContain('Deploy template')
    expect(text).not.toContain('{{')
    // `memory-files`' root IS the memories directory (MemoryStore root).
    const raw = await readFile(join(root, 'MEMORY.md'), 'utf8')
    expect(raw).toContain('{{APP_NAME}}')
  })
})
