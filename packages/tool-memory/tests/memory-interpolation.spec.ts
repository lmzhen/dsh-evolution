// @tier ci-only
/**
 * G6-S2/W8: prompt-variable LITERALS for the memory snapshot.
 *
 * tool-memory registers both its guidance section and the memory snapshot with `interpolate: false`,
 * so stored memory text reaches the model verbatim: a `{{...}}` expression (CI/Jinja/Helm, a doc
 * placeholder) neither throws prompt assembly nor gets substituted with a registered variable such
 * as `{{cwd}}`. The stored bytes were never rewritten; the registration flag is the whole fix.
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

describe('tool-memory · literal prompt variables (G6-S2/W8)', () => {
  it('mount-time snapshot: {{...}} neither throws assembly nor is substituted', async () => {
    const root = await tempRoot('dsh-evolution-tmp-')
    const writer = await mountMemorySeam(root, false)
    await writer.memory.applyBatch('memory', [{ action: 'add', facts: POISON }])
    const ctx = await mountMemorySeam(root, true)
    const text = await snapshotText(ctx)
    // The literal text arrives as written — including the registered name {{cwd}} (NOT resolved to
    // the working directory): a memory entry is data, never a prompt template.
    expect(text).toContain('Deploy template: {{APP_NAME}} on port {{PORT}}')
    expect(text).toContain('{{cwd}}')
    expect(text).not.toContain(root)
  })

  it('refresh path: an entry written after mount stays literal, and the file keeps its bytes', async () => {
    const root = await tempRoot('dsh-evolution-tmp-')
    const ctx = await mountMemorySeam(root, true)
    await ctx.memory.applyBatch('memory', [{ action: 'add', facts: POISON }])
    let text = ''
    for (let attempt = 0; attempt < 50 && !text.includes('Deploy template'); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 20))
      text = await snapshotText(ctx)
    }
    expect(text).toContain('Deploy template: {{APP_NAME}}')
    expect(text).toContain('{{cwd}}')
    // `memory-files`' root IS the memories directory (MemoryStore root).
    const raw = await readFile(join(root, 'MEMORY.md'), 'utf8')
    expect(raw).toContain('{{APP_NAME}}')
  })
})
