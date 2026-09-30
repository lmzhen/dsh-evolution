/**
 * The staged skill write's PREVIEW: what the replay would store, resolved without writing.
 *
 * Driven through the real registration (`ctx.evolutionApproval.previewOf('skill')`), because the wiring is
 * half the contract: the package that runs the replay is the package that must answer the preview. The
 * bytes come from the same helpers the write path uses, so these cases pin the two rules that would
 * otherwise drift: the stage-time anchor decides availability, and the body on disk is the frontmatter-
 * normalized content with exactly one trailing newline.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionApproval from '@deepseek-ai/dsh-evolution-approval'
import SkillUsageRegistry from '@deepseek-ai/dsh-skill-usage'
import { contentHash, normalizeFrontmatter } from '@deepseek-ai/dsh-evolution-core'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as ToolSkillManage from '../src/index.ts'

const BODY = '---\nname: preview-skill\ndescription: preview probe\n---\nBody.\n'

async function setup(): Promise<{ ctx: Context; root: string; home: string | undefined; preview: (args: unknown) => Promise<unknown> }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-approval-preview-'))
  const home = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(SkillUsageRegistry, { root })
  // The approval service declares `evolutionState`; without it the plugin stays pending and the
  // routes/runner/preview this spec reads would never exist.
  ctx.provide('evolutionState', {
    listPending: async () => [],
    savePending: async () => {},
    tryResolvePending: async () => ({ record: null, applied: false }),
    claimPending: async () => null,
    releasePendingClaim: async () => {},
    loadReviewState: async () => null,
    saveReviewState: async () => {},
  })
  await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
  await ctx.plugin(ToolSkillManage)
  // The runner (and its preview companion) is registered inside the tool's
  // `ctx.inject(['evolutionApproval'])` callback, which lands a tick later.
  for (let attempt = 0; attempt < 20 && ctx.evolutionApproval.previewOf('skill') === undefined; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  await mkdir(join(root, 'skills', 'preview-skill'), { recursive: true })
  await writeFile(join(root, 'skills', 'preview-skill', 'SKILL.md'), BODY)
  const preview = ctx.evolutionApproval.previewOf('skill')
  if (preview === undefined) throw new Error('the skill preview was not registered')
  return { ctx, root, home, preview: async (args: unknown) => await preview(args) }
}

const fixtures: Array<{ root: string; home: string | undefined }> = []
afterEach(async () => {
  for (const entry of fixtures.splice(0)) {
    if (entry.home === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = entry.home
    await rm(entry.root, { recursive: true, force: true })
  }
})

async function mount(): Promise<Awaited<ReturnType<typeof setup>>> {
  const fixture = await setup()
  fixtures.push({ root: fixture.root, home: fixture.home })
  return fixture
}

describe('the staged skill write preview', () => {
  it('shows the body the write path would store, from the bytes on disk', async () => {
    const { preview } = await mount()
    // Deliberately un-normalized input: the write path normalizes frontmatter and trims the tail, and
    // the preview must advertise exactly what lands.
    const content = '---\nname: "preview-skill"\ndescription: preview probe\n---\nBody changed.\n\n\n'
    const answer = await preview({
      operation: { action: 'update', name: 'preview-skill', content, staged_from_sha256: contentHash(BODY) },
    }) as { available: boolean; path: string; before: string; after: string }
    expect(answer.available).toBe(true)
    expect(answer.path).toBe('SKILL.md')
    expect(answer.before).toBe(BODY)
    expect(answer.after).toBe(normalizeFrontmatter(content).content.trimEnd() + '\n')
  })

  it('refuses to show a diff the approve path would refuse (stale anchor)', async () => {
    const { preview } = await mount()
    const answer = await preview({
      operation: { action: 'update', name: 'preview-skill', content: BODY, staged_from_sha256: contentHash('something else') },
    }) as { available: boolean; reason: string }
    expect(answer.available).toBe(false)
    expect(answer.reason).toContain('changed after this write was staged')
  })

  it('resolves a patch with the library matcher, and says so when the old text is gone', async () => {
    const { preview } = await mount()
    const applied = await preview({
      operation: { action: 'patch', name: 'preview-skill', old_string: 'Body.', new_string: 'Patched body.', staged_from_sha256: contentHash(BODY) },
    }) as { available: boolean; after: string }
    expect(applied.available).toBe(true)
    expect(applied.after).toContain('Patched body.')
    const missing = await preview({
      operation: { action: 'patch', name: 'preview-skill', old_string: 'not in the body', new_string: 'x', staged_from_sha256: contentHash(BODY) },
    }) as { available: boolean; reason: string }
    expect(missing.available).toBe(false)
    expect(missing.reason).toContain('would be refused')
  })

  it('shows a support file byte for byte, and a removal as an empty after', async () => {
    const { root, preview } = await mount()
    await mkdir(join(root, 'skills', 'preview-skill', 'references'), { recursive: true })
    await writeFile(join(root, 'skills', 'preview-skill', 'references', 'note.md'), 'old note\n')
    const written = await preview({
      operation: { action: 'write_file', name: 'preview-skill', file_path: 'references/note.md', file_content: 'new note', staged_from_sha256: contentHash('old note\n') },
    }) as { available: boolean; path: string; before: string; after: string }
    expect(written).toMatchObject({ available: true, path: 'references/note.md', before: 'old note\n', after: 'new note' })
    const removed = await preview({
      operation: { action: 'remove_file', name: 'preview-skill', file_path: 'references/note.md', staged_from_sha256: contentHash('old note\n') },
    }) as { available: boolean; before: string; after: null }
    expect(removed).toMatchObject({ available: true, before: 'old note\n', after: null })
    const absent = await preview({
      operation: { action: 'remove_file', name: 'preview-skill', file_path: 'references/gone.md', staged_from_sha256: 'absent' },
    }) as { available: boolean; reason: string }
    expect(absent.available).toBe(false)
    expect(absent.reason).toContain('not there to remove')
  })

  it('answers without bytes for operations that have none, and for an unnamed skill', async () => {
    const { preview } = await mount()
    const pinned = await preview({ operation: { action: 'pin', name: 'preview-skill' } }) as { available: boolean; reason: string }
    expect(pinned.available).toBe(false)
    expect(pinned.reason).toContain('no byte-level preview')
    const unnamed = await preview({ operation: { action: 'update' } }) as { available: boolean; reason: string }
    expect(unnamed.reason).toContain('names no skill')
  })
})
