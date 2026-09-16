import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SkillUsageRegistry from '@deepseek-ai/dsh-skill-usage'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionApproval from '@deepseek-ai/dsh-evolution-approval'
import * as ToolSkillManage from '../src/index.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { contentHash } from '@deepseek-ai/dsh-evolution-core'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tempHome } from '../../test-support/temp-home.ts'

function fakeAgent(origin: string | undefined): Agent {
  return { session: { header: { origin }, append: () => {} } } as unknown as Agent
}

/** v30: shared approval-replay harness — `executeCore` through the runner, no
 * schema in front (the forged-pending-record route). */
function replayRun(ctx: Context, operation: Record<string, unknown>, libraryOrigin: 'foreground' | 'background_review' = 'foreground') {
  return ctx.evolutionApproval.run('skill', {
    operation,
    origin: 'background_review',
    libraryOrigin,
  }, { interface: 'background_review' })
}

const SKILL = '---\nname: boundary-skill\ndescription: lifecycle boundary test\n---\nBody.\n'

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-manage-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  try {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    // Explicit root keeps the usage sidecar local to this fixture instead of
    // sharing a registry-level default across tests (B7).
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.plugin(ToolSkillManage)
    return { ctx, root, previousHome }
  } catch (error) {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    throw error
  }
}

describe('tool-skill-manage', () => {
  it('V7-12: the schema strips non-finite/out-of-range limits so the clamp warn only covers direct construction (0.3.43)', () => {
    // Empirical: schemastery REMOVES the invalid key (no error) — NaN, 0 and
    // Infinity all come back undefined, so the plugin's numericClamped warn
    // can only fire for values that bypass the schema (direct construction /
    // another resolver). The warn was moved AFTER the limit() calls (0.3.43)
    // — its position is now correct for those direct-construction paths.
    const s = (ToolSkillManage.Config as unknown as { ['~standard']: { validate(input: unknown): { value?: { maxSkillNameLength?: number } } } })['~standard']
    for (const candidate of [Number.NaN, 0, Number.POSITIVE_INFINITY]) {
      const result = s.validate({ maxSkillNameLength: candidate })
      const value = result.value?.maxSkillNameLength
      expect(Number.isFinite(value)).toBe(false) // never a legal number reaches the plugin
    }
  })

  it('registers the skill_manage tool', async () => {    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root: await mkdtemp(join(tmpdir(), 'dsh-skill-usage-')) })
    await ctx.plugin(ToolSkillManage)
    expect(ctx.tools.get('skill_manage')).toBeDefined()
  })

  it('mounts the Hermes SKILLS_GUIDANCE system-prompt section (alignment)', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root: await mkdtemp(join(tmpdir(), 'dsh-skill-usage-guidance-')) })
    await ctx.plugin(ToolSkillManage)
    const assembly = await ctx.systemPrompt.assemble()
    const rendered = (assembly.sections ?? []).map(s => (typeof s === 'string' ? s : s.text)).join('\n')
    expect(rendered).toContain('Skills guidance:')
    expect(rendered).toContain('don\'t wait to be asked')
    await ctx.fiber.dispose()
  })

  it('reports the authoring check on create and refuses under descriptionStrict (P0)', async () => {
    const { ctx, root, previousHome } = await setup()
    const execute = (args: Record<string, unknown>) => ctx.tools.execute({
      callId: ToolCallId(`authoring-${Math.random()}`),
      name: 'skill_manage',
      arguments: args,
      agent: fakeAgent(undefined),
      signal: new AbortController().signal,
    })
    const over = 'A comprehensive skill that lets the agent search arXiv for academic papers using keywords, authors, and categories. '
    const created = await execute({ action: 'create', name: 'authoring-skill', content: SKILL.replace('boundary-skill', 'authoring-skill').replace('lifecycle boundary test', over) })
    expect(created.isError).toBe(false)
    const message = (created.value as { message?: string } | undefined)?.message ?? ''
    expect(message).toContain('Authoring check:')
    expect(message).toContain('exceeds the 60-char authoring bar')
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('V27 G5.1: the description names replace_all/file_path, and a missing argument names itself', async () => {
    const { ctx, root, previousHome } = await setup()
    const tool = ctx.tools.get('skill_manage') as unknown as { description?: string } | undefined
    // The two fields the model could not discover from the tool contract.
    // v41 A (P2-25): the resident size is PINNED here, captured from the
    // REGISTERED tool — the only authoritative source. (A static estimate over
    // the source block promised 3506 = 1666 inline + 1840 constant and was off
    // by 1151: the expression interpolates more than one constant, which is
    // exactly why this pin has to be runtime-captured.) De-duplication must
    // lower this number and say so; growth must be a deliberate edit here.
    expect((tool?.description ?? '').length).toBe(4657)
    expect(tool?.description ?? '').toContain('replace_all')
    expect(tool?.description ?? '').toContain('file_path')
    const execute = (args: Record<string, unknown>) => ctx.tools.execute({
      callId: ToolCallId(`g51-${Math.random()}`),
      name: 'skill_manage',
      arguments: args,
      agent: fakeAgent(undefined),
      signal: new AbortController().signal,
    })
    await execute({ action: 'create', name: 'g51-skill', content: SKILL.replace('boundary-skill', 'g51-skill') })
    // An omitted argument is named with the action, not surfaced as an empty
    // string downstream ("File not found: ").
    const missing = await execute({ action: 'patch', name: 'g51-skill', new_string: 'x' })
    const missingMessage = (missing.value as { message?: string } | undefined)?.message ?? ''
    expect(missingMessage).toContain('patch requires')
    expect(missingMessage).toContain('old_string')
    // A first-occurrence-only patch reports how many anchors the file carried,
    // so a multi-site edit is never half-applied in silence.
    const content = '---\nname: g51-repeat\ndescription: repeat anchor test\n---\n\nSay hi. Say hi.\n'
    await execute({ action: 'create', name: 'g51-repeat', content })
    const patched = await execute({ action: 'patch', name: 'g51-repeat', old_string: 'Say hi.', new_string: 'Say bye.' })
    const patchMessage = (patched.value as { message?: string } | undefined)?.message ?? ''
    expect(patchMessage).toContain('FIRST of 2 occurrences')
    expect(patchMessage).toContain('replace_all=true')
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('v20 (D-1): a non-string scalar arg is refused structurally, not as a bare TypeError', async () => {
    const { ctx, root, previousHome } = await setup()
    const execute = (args: Record<string, unknown>) => ctx.tools.execute({
      callId: ToolCallId(`scalar-guard-${Math.random()}`),
      name: 'skill_manage',
      arguments: args,
      agent: fakeAgent(undefined),
      signal: new AbortController().signal,
    })
    // A non-string `name` / `old_string` used to escape as a bare TypeError
    // from SkillLibrary (`name.trim is not a function` / `md.includes`) when
    // garbage slipped past the schema (the F-07/V8-09 class). Whichever line
    // fires — schema validation first, the executeCore scalar guard second —
    // the refusal is STRUCTURED, never a raw TypeError (same shape as the
    // V8-09 restructure test above).
    const badName = await execute({ action: 'create', name: 42, content: SKILL })
    expect(badName.isError).toBe(true)
    const nameBox = badName.value as { message?: string } | undefined
    expect(nameBox?.message ?? '').not.toContain('TypeError')
    const badPatch = await execute({ action: 'patch', name: 'scalar-guard-skill', old_string: 7 })
    expect(badPatch.isError).toBe(true)
    const patchBox = badPatch.value as { message?: string } | undefined
    expect(patchBox?.message ?? '').not.toContain('TypeError')
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('v21 (R-2): the scalar gate itself is reached through the approval replay runner (schema bypassed)', async () => {
    // The tool schema rejects a non-string scalar BEFORE executeCore, so the
    // previous test can only prove the refusal is structured end-to-end. The
    // approval replay runner (`evolutionApproval.run('skill', args)`) invokes
    // executeCore DIRECTLY with no schema in front — the exact route a forged
    // pending record would take — so this test drives the new gate itself.
    const { ctx, root, previousHome } = await setup()
    const pending: Array<unknown> = []
    ctx.provide('evolutionState', {
      listPending: async () => pending,
      savePending: async (record: unknown) => { pending.push(record) },
      tryResolvePending: async () => ({ record: null, applied: false }),
      claimPending: async () => null,
      releasePendingClaim: async () => {},
      loadReviewState: async () => null,
      saveReviewState: async () => {},
    })
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    expect(ctx.evolutionApproval.hasRunner('skill')).toBe(true)

    const badName = await replayRun(ctx, { action: 'create', name: 42, content: SKILL })
    expect(badName.ok).toBe(false)
    expect(badName.message).toContain('"name" must be a string')
    const badPatch = await replayRun(ctx, { action: 'patch', name: 'scalar-guard-skill', old_string: 7 })
    expect(badPatch.ok).toBe(false)
    expect(badPatch.message).toContain('"old_string" must be a string')
    // A restructure move with non-string fields is coerced to '' and refused
    // by the library's own structured heading check — also never a TypeError.
    const badMove = await replayRun(ctx, { action: 'restructure', name: 'scalar-guard-skill', restructure: [{ heading: 9, to_file: 'references/x.md' }] })
    expect(badMove.ok).toBe(false)
    expect(badMove.message).not.toContain('TypeError')
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('V24-20a: a null restructure ELEMENT is refused structurally through the schema-bypassed replay runner', async () => {
    const { ctx, root, previousHome } = await setup()
    const pending: Array<unknown> = []
    ctx.provide('evolutionState', {
      listPending: async () => pending,
      savePending: async (record: unknown) => { pending.push(record) },
      tryResolvePending: async () => ({ record: null, applied: false }),
      claimPending: async () => null,
      releasePendingClaim: async () => {},
      loadReviewState: async () => null,
      saveReviewState: async () => {},
    })
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    // `restructure: [null]` used to throw reading `.heading` of null inside
    // the map (the replay channel has no schema in front of it).
    const nullElement = await ctx.evolutionApproval.run('skill', {
      operation: { action: 'restructure', name: 'element-guard-skill', restructure: [null] },
      origin: 'foreground',
      libraryOrigin: 'foreground',
    }, { interface: 'background_review' })
    expect(nullElement.ok).toBe(false)
    expect(nullElement.message).toContain('must be an object')
    expect(nullElement.message).not.toContain('TypeError')
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('reports the write-point frontmatter auto-quote on create (0.3.11)', async () => {
    const { ctx, root, previousHome } = await setup()
    const execute = (args: Record<string, unknown>) => ctx.tools.execute({
      callId: ToolCallId(`norm-${Math.random()}`),
      name: 'skill_manage',
      arguments: args,
      agent: fakeAgent(undefined),
      signal: new AbortController().signal,
    })
    const created = await execute({ action: 'create', name: 'norm-skill', content: SKILL.replace('boundary-skill', 'norm-skill').replace('lifecycle boundary test', 'Search: arXiv papers by keyword.') })
    expect(created.isError).toBe(false)
    const message = (created.value as { message?: string } | undefined)?.message ?? ''
    expect(message).toContain('frontmatter auto-quoted (YAML compatibility): description')
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('refuses an over-bar description when descriptionStrict is enabled (P0)', async () => {
    const root = await tempHome('dsh-skill-strict-')
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.plugin(ToolSkillManage, { descriptionStrict: true })
    const over = 'A comprehensive skill that lets the agent search arXiv for academic papers using keywords, authors, and categories. '
    const result = await ctx.tools.execute({
      callId: ToolCallId(`strict-${Math.random()}`),
      name: 'skill_manage',
      arguments: { action: 'create', name: 'strict-skill', content: SKILL.replace('boundary-skill', 'strict-skill').replace('lifecycle boundary test', over) },
      agent: fakeAgent(undefined),
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect((result.value as { ok?: boolean; message?: string } | undefined)?.ok).toBe(false)
    expect((result.value as { message?: string } | undefined)?.message ?? '').toContain('exceeds the strict bar')
    await ctx.fiber.dispose()
  })

  it('marks review-created skills for curator lifecycle management, but not foreground writes', async () => {
    const { ctx, root, previousHome } = await setup()
    const execute = async (origin: string | undefined, name: string) => ctx.tools.execute({
      callId: ToolCallId(`create-${origin ?? 'foreground'}-${name}`),
      name: 'skill_manage',
      arguments: { action: 'create', name, content: SKILL.replace('boundary-skill', name) },
      agent: fakeAgent(origin),
      signal: new AbortController().signal,
    })
    const background = await execute('subagent', 'review-created')
    expect(background.isError).toBe(false)
    const foreground = await execute(undefined, 'foreground-created')
    expect(foreground.isError).toBe(false)

    const usage = await ctx.skillUsage.report()
    expect(usage.get('review-created')?.created_by).toBe('agent')
    expect(usage.get('foreground-created')?.created_by).toBeNull()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('review and skip are read-only: no counters, no mutation events', async () => {
    const { ctx, root, previousHome } = await setup()
    let mutationEvents = 0
    ctx.on('evolution/skill-mutated', () => { mutationEvents += 1 })
    const execute = (arguments_: Record<string, unknown>) => ctx.tools.execute({
      callId: ToolCallId(`review-skip-${Math.random()}`),
      name: 'skill_manage',
      arguments: arguments_,
      agent: fakeAgent(undefined),
      signal: new AbortController().signal,
    })
    const created = await execute({ action: 'create', name: 'audit-skill', content: SKILL.replace('boundary-skill', 'audit-skill') })
    expect(created.isError).toBe(false)
    expect(mutationEvents).toBe(1)
    const review = await execute({ action: 'review' })
    expect(review.isError).toBe(false)
    expect((review.value as { message?: string } | undefined)?.message ?? '').toContain('Skills:')
    // Create is authorship, not a patch (rc.44 M3-3.3): the counter stays 0
    // so mutation maturity is not inflated by mere creation.
    const patchesBefore = (await ctx.skillUsage.report()).get('audit-skill')?.patch_count ?? 0
    expect(patchesBefore).toBe(0)
    // P3 (v15): 'skip' was removed from the enum (zero callers, dead surface) —
    // 'list' is the remaining read-only probe for the counter assertion.
    const listing = await execute({ action: 'list' })
    expect(listing.isError).toBe(false)
    // Read-only actions neither bump counters nor emit mutation events. The
    // usage sidecar may be shared across fixtures, so assert on the delta.
    expect(mutationEvents).toBe(1)
    const usage = await ctx.skillUsage.report()
    expect(usage.get('audit-skill')?.patch_count).toBe(patchesBefore)
    expect(usage.get('audit-skill')?.use_count).toBe(0)
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('review text aggregates quality-warned skills into one guidance line', async () => {
    const { ctx, root, previousHome } = await setup()
    const execute = (arguments_: Record<string, unknown>) => ctx.tools.execute({
      callId: ToolCallId(`quality-warn-${Math.random()}`),
      name: 'skill_manage',
      arguments: arguments_,
      agent: fakeAgent(undefined),
      signal: new AbortController().signal,
    })
    await execute({ action: 'create', name: 'warned-skill', content: SKILL.replace('boundary-skill', 'warned-skill') })
    await ctx.skillUsage.setFeedbackQuality('warned-skill', 0.1, true)
    const review = await execute({ action: 'review' })
    expect(review.isError).toBe(false)
    const message = (review.value as { message?: string } | undefined)?.message ?? ''
    expect(message).toContain('Warning skills (1): warned-skill')
    expect(message).toContain('consider consolidating')
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('review text marks protection with [pinned] (N-1)', async () => {
    const { ctx, root, previousHome } = await setup()
    const execute = (arguments_: Record<string, unknown>) => ctx.tools.execute({
      callId: ToolCallId(`pin-mark-${Math.random()}`),
      name: 'skill_manage',
      arguments: arguments_,
      agent: fakeAgent(undefined),
      signal: new AbortController().signal,
    })
    await execute({ action: 'create', name: 'pinned-review', content: SKILL.replace('boundary-skill', 'pinned-review') })
    await execute({ action: 'pin', name: 'pinned-review' })
    const review = await execute({ action: 'review' })
    expect(review.isError).toBe(false)
    const message = (review.value as { message?: string } | undefined)?.message ?? ''
    expect(message).toContain('- pinned-review')
    expect(message).toContain('[pinned]')
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('action=edit gets the same authoring strict gate as create/update (M-1)', async () => {
    const root = await tempHome('dsh-skill-strict-edit-')
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.plugin(ToolSkillManage, { descriptionStrict: true })
    const over = 'A comprehensive skill that lets the agent search arXiv for academic papers using keywords, authors, and categories. '
    // edit routes to the same full-content update as update — the gate must not be bypassable.
    const result = await ctx.tools.execute({
      callId: ToolCallId(`edit-strict-${Math.random()}`),
      name: 'skill_manage',
      arguments: { action: 'edit', name: 'edit-strict', content: SKILL.replace('boundary-skill', 'edit-strict').replace('lifecycle boundary test', over) },
      agent: fakeAgent(undefined),
      signal: new AbortController().signal,
    })
    expect((result.value as { ok?: boolean } | undefined)?.ok).toBe(false)
    expect((result.value as { message?: string } | undefined)?.message ?? '').toContain('exceeds the strict bar')
    await ctx.fiber.dispose()
  })

  it('action=restructure moves a body section to references/ (B)', async () => {
    const root = await tempHome('dsh-skill-restructure-')
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    await ctx.plugin(ToolSkillManage)
    const body = `---
name: fat-body
description: restructure fixture.
---

# Fat Body

## Details log

- rc.99 detail

## Usage

Use it.
`
    const created = await ctx.tools.execute({
      callId: ToolCallId(`restructure-create-${Math.random()}`),
      name: 'skill_manage',
      arguments: { action: 'create', name: 'fat-body', content: body },
      agent: fakeAgent(undefined),
      signal: new AbortController().signal,
    })
    expect((created.value as { ok?: boolean } | undefined)?.ok).toBe(true)
    const moved = await ctx.tools.execute({
      callId: ToolCallId(`restructure-move-${Math.random()}`),
      name: 'skill_manage',
      arguments: { action: 'restructure', name: 'fat-body', restructure: [{ heading: 'Details log', to_file: 'references/log.md' }] },
      agent: fakeAgent(undefined),
      signal: new AbortController().signal,
    })
    expect((moved.value as { ok?: boolean } | undefined)?.ok).toBe(true)
    const md = await readFile(join(root, 'skills', 'fat-body', 'SKILL.md'), 'utf8')
    expect(md).toContain('> 详见 references/log.md')
    expect(md).not.toContain('rc.99')
    const sidecar = await ctx.skillUsage.report()
    expect(sidecar.get('fat-body')?.patch_count).toBe(1)
    await ctx.fiber.dispose()
  })

  it('T-13: limit schemas reject zero/negative values at configuration time (0.3.18)', () => {
    const validate = (value: unknown): boolean => {
      const result = (ToolSkillManage.Config as unknown as { ['~standard']: { validate(input: unknown): { value?: unknown; issues?: unknown } } })['~standard'].validate(value)
      return result.issues === undefined
    }
    expect(validate({ maxSkillNameLength: 0 })).toBe(false)
    expect(validate({ maxDescriptionLength: -1 })).toBe(false)
    expect(validate({ maxSkillContentChars: 0 })).toBe(false)
    expect(validate({ maxSkillFileBytes: -5 })).toBe(false)
    expect(validate({})).toBe(true)
    expect(validate({ maxSkillNameLength: 1 })).toBe(true)
  })

  it('V4-27: a no-op update/patch (byte-equivalent, noop:true) is not counted as a modification', async () => {
    const { ctx, root, previousHome } = await setup()
    const execute = (arguments_: Record<string, unknown>) => ctx.tools.execute({
      callId: ToolCallId(`noop-${Math.random()}`),
      name: 'skill_manage',
      arguments: arguments_,
      agent: fakeAgent(undefined),
      signal: new AbortController().signal,
    })
    await execute({ action: 'create', name: 'noop-skill', content: SKILL.replace('boundary-skill', 'noop-skill') })
    // Create is authorship (not a patch): the counter starts at 0.
    expect((await ctx.skillUsage.report()).get('noop-skill')?.patch_count).toBe(0)
    // An update with byte-equivalent content returns core noop:true; the tool
    // gate `result.noop !== true` must NOT bump the mutation counter.
    const onDisk = await readFile(join(root, 'skills', 'noop-skill', 'SKILL.md'), 'utf8')
    const updated = await execute({ action: 'update', name: 'noop-skill', content: onDisk })
    expect((updated.value as { ok?: boolean } | undefined)?.ok).toBe(true)
    expect((updated.value as { message?: string } | undefined)?.message ?? '').toContain('unchanged')
    expect((await ctx.skillUsage.report()).get('noop-skill')?.patch_count).toBe(0)
    // A patch whose old_string already equals the replacement is also noop.
    const patched = await execute({ action: 'patch', name: 'noop-skill', old_string: 'Body.', new_string: 'Body.' })
    expect((patched.value as { ok?: boolean } | undefined)?.ok).toBe(true)
    expect((patched.value as { message?: string } | undefined)?.message ?? '').toContain('unchanged')
    expect((await ctx.skillUsage.report()).get('noop-skill')?.patch_count).toBe(0)
    // A real patch still counts exactly once (the gate is noop-only, not
    // suppression of all patches).
    const realPatch = await execute({ action: 'patch', name: 'noop-skill', old_string: 'Body.', new_string: 'Body.\n\nNew content.' })
    expect((realPatch.value as { ok?: boolean } | undefined)?.ok).toBe(true)
    expect((await ctx.skillUsage.report()).get('noop-skill')?.patch_count).toBe(1)
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('V6-06: NaN numeric limits fall back to the defaults and stay enforced (0.3.35)', async () => {
    const root = await tempHome('dsh-skill-manage-nan-')
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root })
    // NaN passes the number schema (`z.number().min(1)`), so the assembly
    // clamp is the net that must keep the DEFAULT limits enforced — a NaN
    // limit would make every comparison false and silently unlimit writes.
    await ctx.plugin(ToolSkillManage, {
      maxSkillNameLength: NaN,
      maxDescriptionLength: NaN,
      maxSkillContentChars: NaN,
      maxSkillFileBytes: NaN,
    })
    const longName = 'n'.repeat(65)
    const created = await ctx.tools.execute({
      callId: ToolCallId(`nan-${Math.random()}`),
      name: 'skill_manage',
      arguments: { action: 'create', name: longName, content: SKILL.replace('boundary-skill', longName) },
      agent: fakeAgent(undefined),
      signal: new AbortController().signal,
    })
    expect(created.isError).toBe(false)
    expect((created.value as { ok?: boolean } | undefined)?.ok).toBe(false)
  })

  it('V6-15: a byte-equivalent write_file is a no-op — no patch_count bump (0.3.36)', async () => {
    const { ctx, root, previousHome } = await setup()
    const execute = (arguments_: Record<string, unknown>) => ctx.tools.execute({
      callId: ToolCallId(`wf-${Math.random()}`),
      name: 'skill_manage',
      arguments: arguments_,
      agent: fakeAgent(undefined),
      signal: new AbortController().signal,
    })
    await execute({ action: 'create', name: 'wf-skill', content: SKILL.replace('boundary-skill', 'wf-skill') })
    const first = await execute({ action: 'write_file', name: 'wf-skill', file_path: 'references/notes.md', file_content: 'line one\n' })
    expect((first.value as { ok?: boolean } | undefined)?.ok).toBe(true)
    expect((await ctx.skillUsage.report()).get('wf-skill')?.patch_count).toBe(1)
    // A repeated write with identical content used to re-audit, re-emit the
    // mutation event and bump patch_count (V4-27 discipline covers update/patch
    // only). The noop must keep the counter — the sum is real modification.
    const second = await execute({ action: 'write_file', name: 'wf-skill', file_path: 'references/notes.md', file_content: 'line one\n' })
    expect((second.value as { ok?: boolean } | undefined)?.ok).toBe(true)
    expect((second.value as { message?: string } | undefined)?.message ?? '').toContain('unchanged')
    expect((await ctx.skillUsage.report()).get('wf-skill')?.patch_count).toBe(1)
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('V8-09: a non-array restructure argument is a structured refusal, not a TypeError (0.3.47)', async () => {
    const { ctx, root, previousHome } = await setup()
    const execute = (arguments_: Record<string, unknown>) => ctx.tools.execute({
      callId: ToolCallId(`v809-${Math.random()}`),
      name: 'skill_manage',
      arguments: arguments_,
      agent: fakeAgent(undefined),
      signal: new AbortController().signal,
    })
    const result = await execute({ action: 'restructure', name: 'anything', restructure: 5 })
    // The tool schema rejects the malformed value first (isError with a schema
    // message); the executeCore Array.isArray guard is the second line for a
    // value that slips past — either way it is a STRUCTURED refusal, never a
    // bare `.map` TypeError.
    expect(result.isError).toBe(true)
    const box = result.value as { message?: string } | undefined
    expect(box?.message ?? '').not.toContain('TypeError')
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('V10-03 (P2-18): threatExemptLabels defaults to empty (strict scan unchanged) and accepts a label list', () => {
    const s = (ToolSkillManage.Config as unknown as { ['~standard']: { validate(input: unknown): { value?: { threatExemptLabels?: string[] } } } })['~standard']
    // Default: empty list — the ANY-hit-blocks threat behavior is unchanged
    // unless a deployment explicitly opts labels in.
    expect(s.validate({}).value?.threatExemptLabels).toEqual([])
    const configured = s.validate({ threatExemptLabels: ['release-doc-examples', 'authorized-keys-docs'] })
    expect(configured.value?.threatExemptLabels).toEqual(['release-doc-examples', 'authorized-keys-docs'])
  })

  it('V10-03 (P2-18): mounting with threatExemptLabels constructs the library and registers the tool', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(SkillUsageRegistry, { root: await mkdtemp(join(tmpdir(), 'dsh-skill-usage-exempt-')) })
    // The pass-through forwards the labels to the SkillLibrary options
    // (`threatExemptLabels` → core ScanOptions.excludeLabels, linked core
    // change in plan batch 3a.3); the construction itself must stay clean.
    await ctx.plugin(ToolSkillManage, { threatExemptLabels: ['release-doc-examples'] })
    expect(ctx.tools.get('skill_manage')).toBeDefined()
  })
})



it('v29 TSM-01: an inherited-name action (`constructor`) yields the structured refusal, not a TypeError', async () => {
  const { ctx, root, previousHome } = await setup()
  // EvolutionApproval's static inject is ['evolutionState'] — without a
  // provider the service never starts and the replay runner is unreachable.
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
  // The approval replay runner invokes executeCore with STORED args and no
  // schema in front of it — the exact channel where the un-guarded
  // REQUIRED_ARGS index resolved `constructor`/`toString` to inherited
  // functions, `?? []` never fired, and `.filter` threw a bare TypeError.

  for (const hostile of ['constructor', 'toString', 'hasOwnProperty']) {
    const result = await replayRun(ctx, { action: hostile })
    expect(result.ok).toBe(false)
    expect(result.message).toContain(`Unknown action "${hostile}"`)
    expect(result.message).not.toContain('TypeError')
  }
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('v30 REV-02: a replayed write onto a policy-protected skill is refused (background origin only)', async () => {
  const { ctx, root, previousHome } = await setup()
  ctx.provide('evolutionState', {
    listPending: async () => [],
    savePending: async () => {},
    tryResolvePending: async () => ({ record: null, applied: false }),
    claimPending: async () => null,
    releasePendingClaim: async () => {},
    loadReviewState: async () => null,
    saveReviewState: async () => {},
  })
  // The plan gate enforces protectedSkillNames at VALIDATION time; the replay
  // channel executes STORED plans — one accepted under an older policy must
  // not land on a skill the CURRENT policy protects.
  ctx.provide('evolutionPolicy', {
    get: () => ({ protectedSkillNames: ['guarded-skill'] }),
  })
  await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
  // Foreground create of the (now-protected) name is operator freedom.
  const created = await replayRun(ctx, { action: 'create', name: 'guarded-skill', content: SKILL.replace('boundary-skill', 'guarded-skill') }, 'foreground')
  expect(created.ok).toBe(true)
  // The replay (autonomous origin) onto the protected name is refused by the
  // CURRENT policy, even though the tool channel itself would allow it.
  const replayed = await replayRun(ctx, { action: 'update', name: 'guarded-skill', content: SKILL.replace('boundary-skill', 'guarded-skill').replace('lifecycle boundary test', 'updated body') }, 'background_review')
  expect(replayed.ok).toBe(false)
  expect(replayed.message).toContain('protectedSkillNames')
  // The foreground channel stays open.
  const foreground = await replayRun(ctx, { action: 'update', name: 'guarded-skill', content: SKILL.replace('boundary-skill', 'guarded-skill').replace('lifecycle boundary test', 'operator body') }, 'foreground')
  expect(foreground.ok, foreground.message).toBe(true)
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('OPT-01: an update/write_file lands through the REAL runtime with the approval service mounted — the stage anchor must never be written onto the frozen `args` (P0 regression pin)', async () => {
  const { ctx, root, previousHome } = await setup()
  // The DEFAULT bundles (host/all) mount evolution-approval with enabled:false —
  // the service OBJECT is present, so the tool's staging-anchor block runs even
  // though staging is off. The platform ToolRuntime DEEP-FREEZES the arguments
  // object before execute (core/tools `deepFreeze` on the execution context);
  // the old in-place `args.staged_from_sha256 = ...` threw
  // `TypeError: ... not extensible` on EVERY update/edit/write_file/remove_file
  // dispatch. This harness's plain setup() mounts no approval service, so its
  // update tests skipped the block entirely and never saw the freeze — this
  // test mounts it and pins the real dispatch path.
  ctx.provide('evolutionState', {
    listPending: async () => [],
    savePending: async () => {},
    tryResolvePending: async () => ({ record: null, applied: false }),
    claimPending: async () => null,
    releasePendingClaim: async () => {},
    loadReviewState: async () => null,
    saveReviewState: async () => {},
  })
  await ctx.plugin(EvolutionApproval, { enabled: false })
  const execute = (arguments_: Record<string, unknown>) => ctx.tools.execute({
    callId: ToolCallId(`opt01-${Math.random()}`),
    name: 'skill_manage',
    arguments: arguments_,
    agent: fakeAgent(undefined),
    signal: new AbortController().signal,
  })
  const created = await execute({ action: 'create', name: 'frozen-pin', content: SKILL.replace('boundary-skill', 'frozen-pin') })
  expect((created.value as { ok?: boolean } | undefined)?.ok).toBe(true)
  const updated = await execute({ action: 'update', name: 'frozen-pin', content: SKILL.replace('boundary-skill', 'frozen-pin').replace('Body.', 'Updated body.') })
  expect((updated.value as { ok?: boolean } | undefined)?.ok, (updated.value as { message?: string } | undefined)?.message).toBe(true)
  // write_file exercises the 'absent' sentinel assignment branch.
  const written = await execute({ action: 'write_file', name: 'frozen-pin', file_path: 'references/note.md', file_content: 'note' })
  expect((written.value as { ok?: boolean } | undefined)?.ok, (written.value as { message?: string } | undefined)?.message).toBe(true)
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

// P1-13 (v37): the exact defect — a staged update of a skill that does NOT exist
// yet carried no anchor, so a foreground `create` landing between staging and
// approval was overwritten silently on approve. The staging now writes the 'absent'
// sentinel (same form as the support-file path).
it('P1-13: a staged update of a missing skill is refused when the skill appears before approval', async () => {
  const { ctx, root, previousHome } = await setup()
  const pending: Array<{ args?: { operation?: { staged_from_sha256?: string } } }> = []
  ctx.provide('evolutionState', {
    listPending: async () => [],
    savePending: async (record: unknown) => { pending.push(record as { args?: { operation?: { staged_from_sha256?: string } } }) },
    tryResolvePending: async () => ({ record: null, applied: false }),
    claimPending: async () => null,
    releasePendingClaim: async () => {},
    loadReviewState: async () => null,
    saveReviewState: async () => {},
  })
  await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
  const session = { id: 'p113', header: { origin: undefined }, snapshotEvents: () => [] }
  const staged = await ctx.tools.execute({
    callId: ToolCallId(`p113-${Math.random()}`),
    name: 'skill_manage',
    arguments: { action: 'update', name: 'late-skill', content: SKILL.replace('boundary-skill', 'late-skill') },
    agent: { session } as unknown as Agent,
    signal: new AbortController().signal,
  })
  const stagedValue = staged.value as { ok?: boolean; pending_id?: string }
  expect(stagedValue.pending_id).toBeTruthy()
  // The pending record stores the replay wrapper: args.operation is the tool's arg map.
  const operation = pending[0]?.args?.operation
  // Pre-fix the operation carried NO staged_from_sha256 at all; the sentinel is the
  // whole point (an absent target is a first-class anchored state).
  expect(operation?.staged_from_sha256).toBe('absent')
  // The foreground session now creates the same skill.
  const created = await replayRun(ctx, { action: 'create', name: 'late-skill', content: SKILL.replace('boundary-skill', 'late-skill') }, 'foreground')
  expect(created.ok, created.message).toBe(true)
  // Approving the stale plan must be REFUSED — pre-fix this returned ok:true and
  // the freshly created content was replaced by the staged bytes.
  const replayed = await replayRun(ctx, operation as Record<string, unknown>, 'foreground')
  expect(replayed.ok).toBe(false)
  expect(replayed.message).toContain('changed after this write was staged')
  const onDisk = await readFile(join(root, 'skills', 'late-skill', 'SKILL.md'), 'utf8')
  expect(onDisk).toContain('lifecycle boundary test')
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

// P1-13 (v37) second half: the same defect through the approval service (approve
// instead of the replay runner) — the sentinel must survive the pending record and
// the approve must be refused, leaving the created content in place.
it('P1-13: approving the staged update is refused once the skill exists', async () => {
  const { ctx, root, previousHome } = await setup()
  let stored: { id?: string } | undefined
  ctx.provide('evolutionState', {
    listPending: async () => [],
    savePending: async (record: unknown) => { stored = record as { id?: string } },
    tryResolvePending: async () => ({ record: null, applied: true }),
    claimPending: async () => stored ?? null,
    releasePendingClaim: async () => {},
    loadReviewState: async () => null,
    saveReviewState: async () => {},
  })
  await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
  // Same staging route as the sibling test (the TOOL), so the anchor under test is the
  // one the product writes, not a hand-built payload.
  const session = { id: 'p113b', header: { origin: undefined }, snapshotEvents: () => [] }
  const toolStaged = await ctx.tools.execute({
    callId: ToolCallId(`p113b-${Math.random()}`),
    name: 'skill_manage',
    arguments: { action: 'update', name: 'no-anchor-skill', content: SKILL.replace('boundary-skill', 'no-anchor-skill') },
    agent: { session } as unknown as Agent,
    signal: new AbortController().signal,
  })
  const decision = toolStaged.value as { pending_id?: string }
  expect(decision.pending_id).toBeTruthy()
  // The foreground session creates the same skill AFTER staging.
  const created = await replayRun(ctx, { action: 'create', name: 'no-anchor-skill', content: SKILL.replace('boundary-skill', 'no-anchor-skill') }, 'foreground')
  expect(created.ok, created.message).toBe(true)
  const approved = await ctx.evolutionApproval.approve(decision.pending_id as string)
  // Pre-fix this returned ok:true and the created content was replaced.
  expect(approved.ok).toBe(false)
  expect(approved.message).toContain('changed after this write was staged')
  const onDisk = await readFile(join(root, 'skills', 'no-anchor-skill', 'SKILL.md'), 'utf8')
  expect(onDisk).toContain('lifecycle boundary test')
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('v30 REV-03: a staged support-file write refuses to replay when the file changed after staging', async () => {
  const { ctx, root, previousHome } = await setup()
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

  const created = await replayRun(ctx, { action: 'create', name: 'anchor-skill', content: SKILL.replace('boundary-skill', 'anchor-skill') })
  expect(created.ok).toBe(true)
  // The file does NOT exist yet: the honest anchor is the 'absent' sentinel,
  // and the replay proceeds (create-on-write).
  const fresh = await replayRun(ctx, {
    action: 'write_file', name: 'anchor-skill', file_path: 'references/api.md',
    file_content: 'v1\n', staged_from_sha256: 'absent',
  })
  expect(fresh.ok).toBe(true)
  // The file NOW exists (v1 bytes): an anchor claiming 'absent' no longer
  // matches → the stale replay is refused instead of last-writer-wins
  // overwriting the current bytes.
  const staleAbsent = await replayRun(ctx, {
    action: 'write_file', name: 'anchor-skill', file_path: 'references/api.md',
    file_content: 'v2\n', staged_from_sha256: 'absent',
  })
  expect(staleAbsent.ok).toBe(false)
  expect(staleAbsent.message).toContain('changed after this write was staged')
  // An anchor matching the CURRENT bytes (v1) still authorizes the overwrite.
  const freshV2 = await replayRun(ctx, {
    action: 'write_file', name: 'anchor-skill', file_path: 'references/api.md',
    file_content: 'v2\n', staged_from_sha256: contentHash('v1\n'),
  })
  expect(freshV2.ok).toBe(true)
  // remove_file is anchored too: removing with the anchor matching the
  // CURRENT bytes (v2) proceeds.
  const removed = await replayRun(ctx, { action: 'remove_file', name: 'anchor-skill', file_path: 'references/api.md', staged_from_sha256: contentHash('v2\n') })
  expect(removed.ok).toBe(true)
  // A content anchor for a file that is now ABSENT refuses (stale).
  const absentStale = await replayRun(ctx, {
    action: 'write_file', name: 'anchor-skill', file_path: 'references/api.md',
    file_content: 'v4\n', staged_from_sha256: contentHash('some-old-bytes\n'),
  })
  expect(absentStale.ok).toBe(false)
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})


it('v32 TEST-05: the tool channel refuses autonomous (subagent-origin) writes onto policy-protected skills', async () => {
  const { ctx, root, previousHome } = await setup()
  // The policy gates AUTONOMOUS (subagent/review-origin) writes onto
  // protected skills; the operator's foreground channel stays open.
  ctx.provide('evolutionPolicy', {
    get: () => ({ protectedSkillNames: ['guarded-skill'] }),
  })
  const subagent = fakeAgent('subagent')
  const execute = (args: Record<string, unknown>) => ctx.tools.execute({
    callId: ToolCallId(`tsm05-${Math.random()}`),
    name: 'skill_manage',
    arguments: args,
    agent: subagent,
    signal: new AbortController().signal,
  })
  const created = await execute({ action: 'create', name: 'guarded-skill', content: SKILL.replace('boundary-skill', 'guarded-skill') })
  expect(created.isError).toBe(false)
  const updated = await execute({ action: 'update', name: 'guarded-skill', content: SKILL.replace('boundary-skill', 'guarded-skill').replace('lifecycle boundary test', 'updated') })
  // The refusal rides the structured payload (isError stays false by the
  // family's tool contract; the model reads the refusal from the message).
  const updatedMessage = (updated.value as { message?: string } | undefined)?.message ?? JSON.stringify(updated.value)
  expect(updatedMessage).toContain('protectedSkillNames')
  expect(updatedMessage).toContain('guarded-skill')
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

// PLAN-R2 P2-7 (2026-09-16): on an approval-enabled deployment a write missing
// a required argument used to be STAGED — an operator approved it and the
// replay then failed inside executeCore (the same defect class GRAPH-03 /
// OPT-05 / V7-07 closed on their surfaces). The stage boundary must refuse
// first, with executeCore's own structured message.
it('P2-7: a patch missing new_string is refused before the approval seam — approval.request never fires', async () => {
  const { ctx, root, previousHome } = await setup()
  const pending: Array<unknown> = []
  ctx.provide('evolutionState', {
    listPending: async () => pending,
    savePending: async (record: unknown) => { pending.push(record) },
    tryResolvePending: async () => ({ record: null, applied: false }),
    claimPending: async () => null,
    releasePendingClaim: async () => {},
    loadReviewState: async () => null,
    saveReviewState: async () => {},
  })
  await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
  // Count the approval asks without changing the service's decisions (the
  // prototype method must be bound — an unbound `this` rejects mid-request).
  let requests = 0
  const approvalBox = ctx.evolutionApproval as unknown as Record<string, unknown>
  const realRequest = (approvalBox.request as (this: unknown, input: unknown) => Promise<unknown>).bind(ctx.evolutionApproval)
  approvalBox.request = async (input: unknown) => {
    requests += 1
    return realRequest(input)
  }
  const session = { id: 'p27', header: { origin: undefined }, snapshotEvents: () => [] }
  const execute = (args: Record<string, unknown>) => ctx.tools.execute({
    callId: ToolCallId(`p27-${Math.random()}`),
    name: 'skill_manage',
    arguments: args,
    agent: { session } as unknown as Agent,
    signal: new AbortController().signal,
  })
  // The defect shape: patch without new_string — the old code asked for
  // approval and staged it (requests 1, ok:true, pending record saved).
  const missing = await execute({ action: 'patch', name: 'p27-skill', old_string: 'Body.' })
  const missingValue = missing.value as { ok?: boolean; message?: string; pending_id?: string }
  expect(requests).toBe(0)
  expect(missingValue.ok).toBe(false)
  expect(missingValue.message).toContain('skill_manage patch requires new_string')
  expect(missingValue.pending_id).toBeUndefined()
  expect(pending).toHaveLength(0)
  // Positive control on the SAME harness: a complete patch still reaches the
  // approval seam and stages — proving the zero above is the pre-check and
  // not a dead approval block (the old code fails here too: it asked twice).
  const complete = await execute({ action: 'patch', name: 'p27-skill', old_string: 'Body.', new_string: 'Patched body.' })
  const completeValue = complete.value as { ok?: boolean; pending_id?: string; message?: string }
  expect(requests).toBe(1)
  expect(completeValue.ok, completeValue.message).toBe(true)
  expect(completeValue.pending_id).toBeTruthy()
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

// PLAN-R2 P2-5 (2026-09-16): bodies the library cannot produce are not
// content — two of them must not hash-collide into a fake near-duplicate
// group that invites a merge. The ghost dirs use names SKILL_NAME_RE refuses:
// list() (tree-sourced names, unvalidated on purpose) still reports them but
// read() returns null — the exact no-body shape the old `body ?? ''` turned
// into '' (a caught read error feeds the same null through .catch).
it('P2-5: unreadable skill bodies are excluded from review dedup grouping and counted in the output', async () => {
  const { ctx, root, previousHome } = await setup()
  // A real exact-duplicate pair pins the normal path: genuine groups survive.
  const shared = '---\nname: shared-body\ndescription: real near-duplicate pair.\n---\n\nShared body for the dedup pin.\n'
  for (const name of ['same-a', 'same-b']) {
    await mkdir(join(root, 'skills', name), { recursive: true })
    await writeFile(join(root, 'skills', name, 'SKILL.md'), shared)
  }
  // Two no-body skills: tree-visible, but the library yields no body.
  for (const name of ['Ghost_C', 'Ghost_D']) {
    await mkdir(join(root, 'skills', name), { recursive: true })
    await writeFile(join(root, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: unreadable body probe.\n---\n\nBody.\n`)
  }
  const review = await ctx.tools.execute({
    callId: ToolCallId(`p25-${Math.random()}`),
    name: 'skill_manage',
    arguments: { action: 'review' },
    agent: fakeAgent(undefined),
    signal: new AbortController().signal,
  })
  expect(review.isError).toBe(false)
  const message = (review.value as { message?: string } | undefined)?.message ?? ''
  // The real exact-duplicate group is still detected (normal path unchanged).
  expect(message).toContain('- same-a ~ same-b')
  // The two unreadable bodies no longer merge into a fake group ...
  expect(message).not.toContain('Ghost_C ~ Ghost_D')
  expect(message).not.toContain('~ Ghost')
  // ... and the exclusion is visible instead of silent.
  expect(message).toContain('2 skill bodies were unreadable/empty and excluded from dedup grouping.')
  expect(message).toContain('Near-duplicate groups (1)')
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})
