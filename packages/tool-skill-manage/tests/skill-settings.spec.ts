import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SkillUsageRegistry from '@deepseek-ai/dsh-skill-usage'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as ToolSkillManage from '../src/index.ts'
import { validateSkillSettings, type SkillSettings } from '../src/index.ts'
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
    referenceRewrite: 'plan',
    archiveRetention: 'report',
    supportFileCharPolicy: 'report',
  }
}

/** What the fake settings provider recorded, and the live document it serves. */
interface FakeSettings {
  registrations: Array<{ validate?: ((value: unknown) => void) | undefined }>
  /** Commit a new user section and notify the owner, as settings-file does. */
  publish: (next: Record<string, unknown>) => void
}

/** Minimal settings provider stub; see the curator's twin for the rationale. */
function provideSettings(ctx: Context, user: Record<string, unknown>): FakeSettings {
  const watchers: Array<() => void> = []
  const state: FakeSettings = {
    registrations: [],
    publish: (next) => {
      user = next
      for (const callback of watchers) callback()
    },
  }
  ;(ctx.provide as unknown as (name: string, value: unknown) => void).call(ctx, 'settings', {
    register: (_ns: string, _schema: unknown, options: { base: unknown; validate?: (value: unknown) => void }) => {
      state.registrations.push(options.validate === undefined ? {} : { validate: options.validate })
      return {
        get: () => ({ ...(options.base as Record<string, unknown>), ...user }),
        watch: (callback: () => void) => { watchers.push(callback); return () => {} },
      }
    },
    describe: () => [{ ns: 'evolution-skills', user }],
  })
  return state
}

/** Mount the tool over a temp home with a settings provider already in place. */
async function setup(user: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-settings-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(SkillUsageRegistry, { root })
  const settings = provideSettings(ctx, user)
  await ctx.plugin(ToolSkillManage)
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
  return { ctx, settings, execute, cleanup }
}

/** The tool's structured result, as the tests read it back. */
type ToolValue = { ok?: boolean; message?: string }

function valueOf(result: { value?: ToolValue }): ToolValue {
  return result.value ?? {}
}

const OVER_LONG_DESCRIPTION = 'A comprehensive skill that lets the agent search arXiv for academic papers using keywords, authors, and categories. '

describe('skill write settings (G3/S3.4)', () => {
  it('refuses a cap above the deployment value and accepts a tighter one', () => {
    const ceilings = { skillContentChars: 100_000, maxSkillFileBytes: 1_048_576, maxSkillNameLength: 64, maxDescriptionLength: 60 }
    expect(() => { validateSkillSettings({ ...sectionValues(), skillContentChars: 200_000 }, ceilings) })
      .toThrow(/skillContentChars may only be tightened: 200000 exceeds the deployment value 100000/)
    expect(() => { validateSkillSettings({ ...sectionValues(), skillContentChars: 1_000 }, ceilings) }).not.toThrow()
    expect(() => { validateSkillSettings(sectionValues(), ceilings) }).not.toThrow()
  })

  it('registers the tighten-only hook with the platform', async () => {
    const { settings, cleanup } = await setup()
    expect(settings.registrations).toHaveLength(1)
    const validate = settings.registrations[0]?.validate
    expect(typeof validate).toBe('function')
    expect(() => { validate?.({ ...sectionValues(), maxSkillFileBytes: 9_999_999 }) })
      .toThrow(/maxSkillFileBytes may only be tightened/)
    await cleanup()
  })

  it('tightens a write cap at the next write, with no restart', async () => {
    const { settings, execute, cleanup } = await setup()
    const allowed = await execute({ action: 'create', name: 'long-skill-name', content: '---\nname: long-skill-name\ndescription: Long name.\n---\n\nBody.\n' })
    expect(valueOf(allowed).ok, 'the row cap allows the name').toBe(true)
    settings.publish({ maxSkillNameLength: 3 })
    const refused = await execute({ action: 'create', name: 'another-name', content: '---\nname: another-name\ndescription: Another name.\n---\n\nBody.\n' })
    expect(valueOf(refused).ok).toBe(false)
    expect(valueOf(refused).message).toContain('<= 3')
    await cleanup()
  })

  it('switches the support-file stage to enforce and refuses the oversize write', async () => {
    const { settings, execute, cleanup } = await setup()
    await execute({ action: 'create', name: 'caps-skill', content: '---\nname: caps-skill\ndescription: Caps body.\n---\n\nBody.\n' })
    const long = 'x'.repeat(300)
    // Row default: report only — the write lands with an advisory.
    const reported = await execute({ action: 'write_file', name: 'caps-skill', file_path: 'references/big.md', file_content: long })
    expect(valueOf(reported).ok).toBe(true)
    // User layer: tightens the character cap AND selects the enforcing stage.
    settings.publish({ skillContentChars: 200, supportFileCharPolicy: 'enforce' })
    const enforced = await execute({ action: 'write_file', name: 'caps-skill', file_path: 'references/big2.md', file_content: long })
    expect(valueOf(enforced).ok).toBe(false)
    expect(valueOf(enforced).message).toContain('exceeds 200 characters')
    await cleanup()
  })

  it('turns the strict description bar on for the next write', async () => {
    const { settings, execute, cleanup } = await setup()
    const over = (name: string) => '---\nname: ' + name + '\ndescription: ' + OVER_LONG_DESCRIPTION + '\n---\n\nBody.\n'
    const advisory = await execute({ action: 'create', name: 'advisory-skill', content: over('advisory-skill') })
    expect(valueOf(advisory).ok, 'the row advises instead of refusing').toBe(true)
    expect(valueOf(advisory).message).toContain('Authoring check:')
    settings.publish({ descriptionStrict: true })
    const refused = await execute({ action: 'create', name: 'strict-skill', content: over('strict-skill') })
    expect(valueOf(refused).ok).toBe(false)
    expect(valueOf(refused).message).toContain('strict bar')
    await cleanup()
  })

  it('switches the citation stage to refuse for a section that stays behind', async () => {
    const { settings, execute, cleanup } = await setup()
    const body = (name: string) => ['---', 'name: ' + name, 'description: Cited body.', '---', '', '# Cited', '', '## Log', '', '> 详见 references/notes.md', '', '## Usage', '', 'Use it.', ''].join('\n')
    const plant = async (name: string) => {
      await execute({ action: 'create', name, content: body(name) })
      await execute({ action: 'write_file', name, file_path: 'references/notes.md', file_content: 'Notes.\n' })
    }
    await plant('verified-skill')
    const verified = await execute({ action: 'restructure', name: 'verified-skill', restructure: [{ heading: 'Log', to_file: 'references/log.md' }] })
    expect(valueOf(verified).ok, 'the row verifies the citation and allows the move').toBe(true)
    await plant('refused-skill')
    settings.publish({ citationPolicy: 'refuse' })
    const refused = await execute({ action: 'restructure', name: 'refused-skill', restructure: [{ heading: 'Log', to_file: 'references/log.md' }] })
    expect(valueOf(refused).ok).toBe(false)
    expect(valueOf(refused).message).toContain('references support files')
    await cleanup()
  }, 30_000)
})
