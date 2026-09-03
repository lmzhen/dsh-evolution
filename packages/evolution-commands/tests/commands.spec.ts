import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import * as Commands from '../src/index.ts'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('evolution-commands', () => {
  it('loads without the commands service mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(Commands)
    expect(ctx.get('commands')).toBeUndefined()
  })

  it('dispatches consolidate and skill restore to the curator service', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', {
      register: (definition: unknown) => {
        captured = definition as typeof captured
        return () => {}
      },
    })
    const calls: string[] = []
    ctx.provide('evolutionCurator', {
      consolidate: async (target: string, sources: string[]) => {
        calls.push(`consolidate:${target}:${sources.join(',')}`)
        return { ok: true, message: `Consolidated ${sources.join(', ')} into "${target}".` }
      },
      restore: async (name: string) => {
        calls.push(`restore:${name}`)
        return { ok: true, message: `Skill "${name}" restored from .archive.` }
      },
    })
    await ctx.plugin(Commands)
    expect(captured).toBeDefined()
    const result = await captured!.handler({ rawInput: 'consolidate target-a source-b source-c' })
    expect(result.text).toContain('Consolidated source-b, source-c into "target-a".')
    expect(calls).toEqual(['consolidate:target-a:source-b,source-c'])
    const restoreResult = await captured!.handler({ rawInput: 'skill restore source-b' })
    expect(restoreResult.text).toContain('restored from .archive.')
    expect(calls).toEqual(['consolidate:target-a:source-b,source-c', 'restore:source-b'])
    // Commands runtime contract: handlers must return a CommandResult with kind.
    expect(result.kind).toBe('success')
    expect(restoreResult.kind).toBe('success')
    const missing = await captured!.handler({ rawInput: 'approve some-id' })
    expect(missing.kind).toBe('error')
  })

  it('learn injects the standards-guided prompt into the invoking agent (rc.67)', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string; agent?: { inject(message: unknown): void } }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', {
      register: (definition: unknown) => {
        captured = definition as typeof captured
        return () => {}
      },
    })
    const injected: unknown[] = []
    await ctx.plugin(Commands)
    const withRequest = await captured!.handler({ rawInput: 'learn distill the auth flow from <url>', agent: { inject: (message: unknown) => injected.push(message) } })
    // The command result only feeds the UI; the agent receives the message.
    expect(withRequest.text).toContain('Learning request sent')
    expect(withRequest.text).not.toContain('THE REQUEST:')
    expect(injected).toHaveLength(1)
    const message = injected[0] as { content: Array<{ text?: string }>; source?: { plugin?: string }; role?: string }
    // UserMessage contract: role is required and minted by createUserMessage.
    expect(message.role).toBe('user')
    expect(message.source?.plugin).toBe('dsh-evolution-commands')
    expect(message.content?.[0]?.text).toContain('distill the auth flow from <url>')
    expect(message.content?.[0]?.text).toContain('skill_manage')
    // Empty argument falls back to the "what we just did" guidance.
    const empty = await captured!.handler({ rawInput: 'learn', agent: { inject: (message: unknown) => injected.push(message) } })
    expect(empty.text).toContain('Learning request sent')
    expect((injected[1] as { content: Array<{ text?: string }> }).content?.[0]?.text).toContain('the workflow we just went through')
  })

  it('skills health renders degraded structure rows or a clean verdict (rc.73 A1)', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', {
      register: (definition: unknown) => {
        captured = definition as typeof captured
        return () => {}
      },
    })
    let first = true
    let observed = true
    ctx.provide('evolutionCurator', {
      healthView: async () => {
        if (!first) return []
        first = false
        return [
          { name: 'fat-skill', verdict: 'needs-restructure', reasons: ['body 41000 chars is >= 2x the soft limit (20000)'] },
          { name: 'log-skill', verdict: 'warn', reasons: ['stamp density 3.2/KB'] },
        ]
      },
      usageObserved: async () => observed,
    })
    await ctx.plugin(Commands)
    const result = await captured!.handler({ rawInput: 'skills health' })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('Structure health (2 degraded):')
    expect(result.text).toContain('needs-restructure  fat-skill')
    expect(result.text).toContain('stamp density')
    expect(result.text).not.toContain('Usage observation')
    const empty = await captured!.handler({ rawInput: 'skills health' })
    expect(empty.text).toContain('all skills healthy')
    // C observation window: before any observed read, the verdict says so.
    observed = false
    const windowed = await captured!.handler({ rawInput: 'skills health' })
    expect(windowed.text).toContain('Usage observation not yet established')
    expect(windowed.text).toContain('all skills healthy')
  })

  it('records a learn event into the event log when the io registry is mounted (rc.68)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-cmd-learn-event-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const ctx = new Context()
      let captured: { handler(invocation: { rawInput?: string; agent?: { inject(message: unknown): void } }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
      ctx.provide('commands', {
        register: (definition: unknown) => {
          captured = definition as typeof captured
          return () => {}
        },
      })
      ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
      const injected: unknown[] = []
      await ctx.plugin(Commands)
      await captured!.handler({ rawInput: 'learn node packaging', agent: { inject: (message: unknown) => injected.push(message) } })
      // The append is fire-and-forget; give the locked RMW a settle window.
      await new Promise(resolve => setTimeout(resolve, 50))
      const raw = await nodeEvolutionIo().readText(join(home, 'evolution', 'events.json'))
      expect(raw).not.toBeNull()
      const parsed = JSON.parse(raw ?? '{}') as { events: Array<{ type?: string; source?: string; request?: string }> }
      expect(parsed.events).toHaveLength(1)
      expect(parsed.events[0]).toMatchObject({ type: 'learn', source: 'manual', request: 'node packaging' })
      expect(injected).toHaveLength(1)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  })

  it('curator scope renders the lifecycle lists including quality-warned', async () => {    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', {
      register: (definition: unknown) => {
        captured = definition as typeof captured
        return () => {}
      },
    })
    ctx.provide('evolutionCurator', {
      scopeView: async () => ({ managed: ['hub-skill'], watched: ['stale-skill', 'warn-skill'], qualityWarned: ['warn-skill'], exempted: ['scheduled'], protected: ['pinned-skill'] }),
    })
    await ctx.plugin(Commands)
    const result = await captured!.handler({ rawInput: 'curator scope' })
    expect(result.text).toContain('Managed (may transition): 1')
    expect(result.text).toContain('hub-skill')
    expect(result.text).toContain('Watched (stale / quality-warned): 2')
    expect(result.text).toContain('Quality-warned: 1')
    expect(result.text).toContain('warn-skill')
    expect(result.text).toContain('Exempted (exclude / referenced): 1')
    expect(result.text).toContain('scheduled')
    expect(result.text).toContain('Protected (pinned / bundled / hub): 1')
  })

  it('restore dispatches the full-state snapshot restore to the curator', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', {
      register: (definition: unknown) => {
        captured = definition as typeof captured
        return () => {}
      },
    })
    const calls: string[] = []
    ctx.provide('evolutionCurator', {
      restoreSnapshot: async () => {
        calls.push('restoreSnapshot')
        return { ok: true, message: 'Restored skill tree from /path' }
      },
    })
    await ctx.plugin(Commands)
    const result = await captured!.handler({ rawInput: 'restore snap' })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('Restored skill tree from /path')
    expect(calls).toEqual(['restoreSnapshot'])
  })
  it('dispatches curator pause/resume/status to the curator service (G2)', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', {
      register: (definition: unknown) => {
        captured = definition as typeof captured
        return () => {}
      },
    })
    const calls: Array<{ paused: boolean }> = []
    let state: { lastRunAt: number; runCount: number; lastSummary: string; paused: boolean } | null = {
      lastRunAt: Date.now() - 3_600_000, runCount: 2, lastSummary: 'auto: stale:0 archived:0', paused: false,
    }
    ctx.provide('evolutionCurator', {
      setPaused: async (paused: boolean) => {
        calls.push({ paused })
        state = { ...state!, paused }
      },
      status: async () => state,
    })
    await ctx.plugin(Commands)
    const pause = await captured!.handler({ rawInput: 'curator pause' })
    expect(pause.kind).toBe('success')
    expect(pause.text).toContain('paused')
    expect(calls).toEqual([{ paused: true }])
    const status = await captured!.handler({ rawInput: 'curator status' })
    expect(status.kind).toBe('success')
    expect(status.text).toContain('paused=true')
    expect(status.text).toContain('runs=2')
    const resume = await captured!.handler({ rawInput: 'curator resume' })
    expect(resume.text).toContain('resumed')
    expect(calls).toEqual([{ paused: true }, { paused: false }])
    // Without persisted state the status command degrades gracefully.
    state = null
    const empty = await captured!.handler({ rawInput: 'curator status' })
    expect(empty.text).toContain('No curator state yet')
  })

  it('curator status survives a corrupt lastRunAt (rc.43 regression)', async () => {

    const ctx = new Context()

    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined

    ctx.provide('commands', {

      register: (definition: unknown) => {

        captured = definition as typeof captured

        return () => {}

      },

    })

    ctx.provide('evolutionCurator', {

      status: async () => ({ lastRunAt: Number.NaN, runCount: 2, lastSummary: 'corrupt', paused: false }),

    })

    await ctx.plugin(Commands)

    const result = await captured!.handler({ rawInput: 'curator status' })

    // Invalid Date().toISOString() used to throw a RangeError out of the handler.

    expect(result.kind).toBe('success')

    expect(result.text).toContain('lastRun=unknown')

  })

  it('maintain fails closed without io or subagents, and reports usage on syntax errors', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', {
      register: (definition: unknown) => {
        captured = definition as typeof captured
        return () => {}
      },
    })
    await ctx.plugin(Commands)
    const noIo = await captured!.handler({ rawInput: 'maintain' })
    expect(noIo.kind).toBe('error')
    expect(noIo.text).toContain('IO registry')
    const badRestructure = await captured!.handler({ rawInput: 'restructure bad-syntax' })
    expect(badRestructure.kind).toBe('error')
    expect(badRestructure.text).toContain('Usage:')
    const badToFile = await captured!.handler({ rawInput: 'restructure demo "Log" scripts/log.sh' })
    expect(badToFile.kind).toBe('error')
    expect(badToFile.text).toContain('references/')
  })

  it('restructure rejects missing skills via the real SkillLibrary path (no side effects)', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', {
      register: (definition: unknown) => {
        captured = definition as typeof captured
        return () => {}
      },
    })
    const io = nodeEvolutionIo()
    ctx.provide('evolutionIo', {
      provider: () => io,
    })
    await ctx.plugin(Commands)
    // The command constructs SkillLibrary over the default skills root; use a
    // guaranteed-absent skill name so the path resolves to an error without
    // touching real content.
    const missingSkill = await captured!.handler({ rawInput: 'restructure evo-nonexistent-skill "Log" references/log.md' })
    expect(missingSkill.kind).toBe('error')
  })

  it('restructure succeeds end-to-end on a temp library via Config.skillsRoot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evo-commands-restructure-'))
    const root = join(dir, 'skills')
    const skillDir = join(root, 'demo-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill for restructure tests.\n---\n\n# Demo\n\n## Log\n\nold detail\n\n## Keep\n\nnew\n', 'utf8')
    try {
      const ctx = new Context()
      let captured: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
      ctx.provide('commands', {
        register: (definition: unknown) => {
          captured = definition as typeof captured
          return () => {}
        },
      })
      const io = nodeEvolutionIo()
      ctx.provide('evolutionIo', {
        provider: () => io,
      })
      // Config.skillsRoot is the command-facing root (A7 alignment) — the
      // temp root keeps the mutation off the real library.
      await ctx.plugin(Commands, { skillsRoot: root })
      const result = await captured!.handler({ rawInput: 'restructure demo-skill "Log" references/log.md' })
      expect(result.kind).toBe('success')
      const body = await io.readText(join(skillDir, 'SKILL.md'))
      expect(body).not.toContain('old detail')
      expect(body).toContain('references/log.md')
      const support = await io.readText(join(root, 'demo-skill', 'references', 'log.md'))
      expect(support).toContain('old detail')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

})
