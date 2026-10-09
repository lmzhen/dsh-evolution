import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SkillUsageRegistry from '@deepseek-ai/dsh-skill-usage'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as ToolSkillManage from '../src/index.ts'
import { validateSkillSettings, type SkillSettings } from '../src/index.ts'
import { mutableVol } from '../../test-support/volatile-config.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function fakeAgent(): Agent {
  return { session: { header: { origin: undefined }, append: () => {} } } as unknown as Agent
}

/** A resolved section at the row defaults, as the platform would hand it over. */
function sectionValues(): SkillSettings {
  return {
    skillContentChars: 100_000,
    maxSkillFileBytes: 1_048_576,
    maxSkillNameLength: 64,
    maxDescriptionLength: 60,
    descriptionStrict: false,
    strictCrossSource: false,
    citationPolicy: 'verify',
    supportFileCharPolicy: 'report',
    skillWriteConfirm: 'auto',
    skillWriteConfirmTimeoutSeconds: 120,
  }
}

/**
 * A fake platform settings provider carrying only the user layer.
 *
 * G1 keeps ONE read of it — the KEY NAMES `describe()` reports, which name the
 * winning surface. The user VALUE reaches the plugin through the row's live field,
 * so a test supplies that value as a reference it can move (see `setup`).
 * @param ctx - the test context.
 * @param user - the raw user section `describe()` reports.
 */
function provideSettings(ctx: Context, user: Record<string, unknown>): void {
  ;(ctx.provide as unknown as (name: string, value: unknown) => void).call(ctx, 'settings', {
    // The platform's settings id is the Loader entry id, i.e. the ROW id — the legacy
    // namespace string ('evolution-skills') is only the G3 migration source.
    describe: () => [{ ns: 'tool-skill-manage', user }],
  })
}

/**
 * Mount the tool over a temp home with its live config references.
 *
 * The plugin is applied DIRECTLY (not through the Loader) so each E3 field can be a
 * reference the test moves — that is what the platform hands a volatile field, and
 * moving it is exactly what a committed settings edit does.
 * @param config - the row config; volatile fields carry mutable references.
 * @param user - the user section `describe()` reports (key names only).
 * @param policy - the evolution-policy snapshot, when the case needs one.
 * @returns the context, the tool runner, and the cleanup hook.
 */
async function setup(
  config: Record<string, unknown> = {},
  user: Record<string, unknown> = {},
  policy?: Record<string, unknown>,
) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-settings-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(SkillUsageRegistry, { root })
  provideSettings(ctx, user)
  if (policy !== undefined) ctx.provide('evolutionPolicy', { get: () => policy })
  ToolSkillManage.apply(ctx, config)
  const execute = async (args: Record<string, unknown>): Promise<{ value?: ToolValue }> => await ctx.tools.execute({
    callId: ToolCallId(`settings-${Math.random()}`),
    name: 'skill_manage',
    arguments: args,
    agent: fakeAgent(),
    signal: new AbortController().signal,
  }) as { value?: ToolValue }
  const cleanup = async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
  return { ctx, execute, cleanup, root }
}

/** The tool's structured result, as the tests read it back. */
type ToolValue = { ok?: boolean; message?: string }

function valueOf(result: { value?: ToolValue }): ToolValue {
  return result.value ?? {}
}

const OVER_LONG_DESCRIPTION = 'A comprehensive skill that lets the agent search arXiv for academic papers using keywords, authors, and categories. '

describe('skill write settings (G3/S3.4 + G1)', () => {
  it('refuses a cap above the deployment value and accepts a tighter one', () => {
    const ceilings = { skillContentChars: 100_000, maxSkillFileBytes: 1_048_576, maxSkillNameLength: 64, maxDescriptionLength: 60 }
    expect(() => { validateSkillSettings({ ...sectionValues(), skillContentChars: 200_000 }, ceilings) })
      .toThrow(/skillContentChars may only be tightened: 200000 exceeds the deployment value 100000/)
    expect(() => { validateSkillSettings({ ...sectionValues(), skillContentChars: 1_000 }, ceilings) }).not.toThrow()
    expect(() => { validateSkillSettings(sectionValues(), ceilings) }).not.toThrow()
  })

  // G1 §0.3 + §8.5 step 4: the rule the old settings `validate` hook enforced rides
  // the platform's config waterfall, which the platform runs on every candidate BEFORE
  // it writes (config-editor/src/index.ts:103). Driving that waterfall is the wiring
  // proof: a widening candidate throws, a tightening one passes through untouched.
  it('G1: the tighten-only rule rides the config waterfall', async () => {
    const cap = mutableVol<number | undefined>(1_000)
    const { ctx, cleanup } = await setup({ skillContentChars: cap.ref })
    const candidate = (value: unknown): unknown => ctx.waterfall(ctx.fiber, 'internal/config', value, () => value)
    expect(() => candidate({ skillContentChars: 2_000 }))
      .toThrow(/skillContentChars may only be tightened: 2000 exceeds the deployment value 1000/)
    expect(() => candidate({ skillContentChars: 500 })).not.toThrow()
    // A candidate that does not touch the caps is unconstrained.
    expect(() => candidate({ descriptionStrict: true })).not.toThrow()
    await cleanup()
  })

  it('T2-09/A24: the approved replay re-reads the caps — a record staged under a wider cap is refused after the user tightens it', async () => {
    const contentCap = mutableVol(100_000)
    const { ctx, execute, cleanup, root } = await setup({ skillContentChars: contentCap.ref })
    // The approval seam must exist for the write to STAGE (this is the replay path, not the tool path).
    const EvolutionApproval = (await import('@deepseek-ai/dsh-evolution-approval')).default
    const EvolutionStateStorage = (await import('@deepseek-ai/dsh-evolution-state-storage')).default
    const JsonState = await import('@deepseek-ai/dsh-evolution-state-json')
    const EvolutionState = (await import('@deepseek-ai/dsh-evolution-state')).default
    await ctx.plugin(EvolutionStateStorage)
    await ctx.plugin(JsonState, { root })
    await ctx.plugin(EvolutionState)
    await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
    const body = '---\nname: capped-skill\ndescription: Capped body.\n---\n\n' + 'x'.repeat(300) + '\n'
    const staged = await execute({ action: 'create', name: 'capped-skill', content: body })
    expect(valueOf(staged).ok).toBe(true)
    const pendingId = (staged.value as { pending_id?: string } | undefined)?.pending_id
    expect(pendingId).toBeTypeOf('string')
    // The user tightens the cap WHILE the record sits in the window.
    contentCap.set(120)
    const approved = await ctx.evolutionApproval.approve(String(pendingId))
    // The replay re-materializes the caps at the execution point: the old 100_000 cap must NOT be used.
    expect(approved.ok).toBe(false)
    expect(approved.message).toContain('exceeds 120 characters')
    await cleanup()
  })

  it('tightens a write cap at the next write, with no restart', async () => {
    const nameCap = mutableVol(64)
    const { execute, cleanup } = await setup({ maxSkillNameLength: nameCap.ref })
    const allowed = await execute({ action: 'create', name: 'long-skill-name', content: '---\nname: long-skill-name\ndescription: Long name.\n---\n\nBody.\n' })
    expect(valueOf(allowed).ok, 'the row cap allows the name').toBe(true)
    // G1: the platform writes a committed value into the live reference, and the next
    // call reads it — no settings hook, no watcher, no restart.
    nameCap.set(3)
    const refused = await execute({ action: 'create', name: 'another-name', content: '---\nname: another-name\ndescription: Another name.\n---\n\nBody.\n' })
    expect(valueOf(refused).ok).toBe(false)
    expect(valueOf(refused).message).toContain('<= 3')
    await cleanup()
  })

  it('switches the support-file stage to enforce and refuses the oversize write', async () => {
    const contentCap = mutableVol<number | undefined>(100_000)
    const fileStage = mutableVol<'report' | 'enforce'>('report')
    const { execute, cleanup } = await setup({ skillContentChars: contentCap.ref, supportFileCharPolicy: fileStage.ref })
    await execute({ action: 'create', name: 'caps-skill', content: '---\nname: caps-skill\ndescription: Caps body.\n---\n\nBody.\n' })
    const long = 'x'.repeat(300)
    // Row default: report only — the write lands with an advisory.
    const reported = await execute({ action: 'write_file', name: 'caps-skill', file_path: 'references/big.md', file_content: long })
    expect(valueOf(reported).ok).toBe(true)
    // The user tightens the character cap AND selects the enforcing stage.
    fileStage.set('enforce')
    contentCap.set(200)
    const enforced = await execute({ action: 'write_file', name: 'caps-skill', file_path: 'references/big2.md', file_content: long })
    expect(valueOf(enforced).ok).toBe(false)
    expect(valueOf(enforced).message).toContain('exceeds 200 characters')
    await cleanup()
  })

  // G1 §8.4-A: the user layer sits ABOVE the deployment stages. The value arrives
  // through the row's live field and `describe()` names the key, so the user's
  // 'enforce' beats the policy's 'report' — without the veto the stage would win and
  // the oversize write would land with an advisory.
  it('G1: a user-set stage beats the deployment stage', async () => {
    const contentCap = mutableVol<number | undefined>(200)
    const fileStage = mutableVol<'report' | 'enforce'>('enforce')
    const { execute, cleanup } = await setup(
      { skillContentChars: contentCap.ref, supportFileCharPolicy: fileStage.ref },
      { supportFileCharPolicy: 'enforce' },
      { supportFileCharPolicy: 'report' },
    )
    await execute({ action: 'create', name: 'veto-skill', content: '---\nname: veto-skill\ndescription: Veto body.\n---\n\nBody.\n' })
    const refused = await execute({ action: 'write_file', name: 'veto-skill', file_path: 'references/big.md', file_content: 'x'.repeat(300) })
    expect(valueOf(refused).ok).toBe(false)
    expect(valueOf(refused).message).toContain('exceeds 200 characters')
    await cleanup()
  })

  it('turns the strict description bar on for the next write', async () => {
    const strict = mutableVol(false)
    const { execute, cleanup } = await setup({ descriptionStrict: strict.ref })
    const over = (name: string) => '---\nname: ' + name + '\ndescription: ' + OVER_LONG_DESCRIPTION + '\n---\n\nBody.\n'
    const advisory = await execute({ action: 'create', name: 'advisory-skill', content: over('advisory-skill') })
    expect(valueOf(advisory).ok, 'the row advises instead of refusing').toBe(true)
    expect(valueOf(advisory).message).toContain('Authoring check:')
    strict.set(true)
    const refused = await execute({ action: 'create', name: 'strict-skill', content: over('strict-skill') })
    expect(valueOf(refused).ok).toBe(false)
    expect(valueOf(refused).message).toContain('strict bar')
    await cleanup()
  })

  it('switches the citation stage to refuse for a section that stays behind', async () => {
    const citation = mutableVol<'verify' | 'refuse'>('verify')
    const { execute, cleanup } = await setup({ citationPolicy: citation.ref })
    const body = (name: string) => ['---', 'name: ' + name, 'description: Cited body.', '---', '', '# Cited', '', '## Log', '', '> 详见 references/notes.md', '', '## Usage', '', 'Use it.', ''].join('\n')
    const plant = async (name: string) => {
      await execute({ action: 'create', name, content: body(name) })
      await execute({ action: 'write_file', name, file_path: 'references/notes.md', file_content: 'Notes.\n' })
    }
    await plant('verified-skill')
    const verified = await execute({ action: 'restructure', name: 'verified-skill', restructure: [{ heading: 'Log', to_file: 'references/log.md' }] })
    expect(valueOf(verified).ok, 'the row verifies the citation and allows the move').toBe(true)
    await plant('refused-skill')
    citation.set('refuse')
    const refused = await execute({ action: 'restructure', name: 'refused-skill', restructure: [{ heading: 'Log', to_file: 'references/log.md' }] })
    expect(valueOf(refused).ok).toBe(false)
    expect(valueOf(refused).message).toContain('references support files')
    await cleanup()
  }, 30_000)
})
