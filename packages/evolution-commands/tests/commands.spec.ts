import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import * as Commands from '../src/index.ts'
import { existsSync, readFileSync } from 'node:fs'
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
      // The append is fire-and-forget; poll for the locked RMW to land — a
      // fixed sleep is load-sensitive (the full parallel suite crossed 50ms).
      const eventPath = join(home, 'evolution', 'events.json')
      const deadline = Date.now() + 5000
      let raw: string | null = null
      while (raw === null && Date.now() < deadline) {
        raw = await nodeEvolutionIo().readText(eventPath)
        if (raw === null) await new Promise(resolve => setTimeout(resolve, 50))
      }
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

  it('maintain enriches support files and reports pointer_missing truthfully (v11 P1-1)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evo-commands-enrich-'))
    const root = join(dir, 'skills')
    const skillDir = join(root, 'demo-skill')
    await mkdir(join(skillDir, 'references'), { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# Demo\n\n## Run\n\ndo it\n', 'utf8')
    await writeFile(join(skillDir, 'references', 'notes.md'), '# notes\n', 'utf8')
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
      ctx.provide('evolutionIo', { provider: () => io })
      let capturedPrompt = ''
      ctx.provide('subagents', {
        async start(_kind: string, options: unknown) {
          const opts = options as { prompt?: Array<{ text: string }> }
          capturedPrompt = opts.prompt?.[0]?.text ?? ''
          return {
            result: Promise.resolve({ text: 'x', structured: { verdict: 'no_issues', plan: [], notes: [] } }),
          }
        },
      })
      await ctx.plugin(Commands, { skillsRoot: root })
      const result = await captured!.handler({ rawInput: 'maintain' })
      expect(result.kind).toBe('success')
      // Enriched facts: the unlinked support file is reported as a real over,
      // never a fabricated pass/unknown.
      expect(capturedPrompt).toContain('signal=pointer_missing')
      expect(capturedPrompt).toMatch(/signal=pointer_missing value=references\/notes\.md verdict=over/)
      expect(capturedPrompt).toContain('signal=description_chars')
      expect(capturedPrompt).toContain('signal=usage_observed')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('maintain --timeout overrides the subagent deadline for this run (0.3.4)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evo-commands-timeout-'))
    const root = join(dir, 'skills')
    // A non-empty library: runMaintain short-circuits an EMPTY library before
    // the subagent start (so the signal capture below would stay undefined).
    await mkdir(join(root, 'demo-skill'), { recursive: true })
    await writeFile(join(root, 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# Demo\n\nbody\n', 'utf8')
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
      ctx.provide('evolutionIo', { provider: () => io })
      let capturedSignal: AbortSignal | undefined
      ctx.provide('subagents', {
        async start(_kind: string, options: unknown) {
          capturedSignal = (options as { signal?: AbortSignal }).signal
          return {
            result: Promise.resolve({ text: 'x', structured: { verdict: 'no_issues', plan: [], notes: [] } }),
          }
        },
      })
      // maintainCooldownMs: 0 — the cooldown is module-level transient state,
      // and an earlier test already ran `maintain` (would block this run and
      // skip the subagent call, leaving the signal capture undefined).
      await ctx.plugin(Commands, { skillsRoot: root, maintainCooldownMs: 0 })
      const bad = await captured!.handler({ rawInput: 'maintain --timeout 0' })
      expect(bad.kind).toBe('error')
      expect(bad.text).toContain('Invalid --timeout')
      const good = await captured!.handler({ rawInput: 'maintain --timeout 600000' })
      expect(good.kind).toBe('success')
      expect(capturedSignal).toBeTruthy()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('single-flight: a re-trigger during a running scan returns already-running and does not spawn (0.3.11)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evo-commands-singleflight-'))
    const root = join(dir, 'skills')
    await mkdir(join(root, 'demo-skill'), { recursive: true })
    await writeFile(join(root, 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# Demo\n\nbody\n', 'utf8')
    let handler: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    let starts = 0
    let resolveRun: (() => void) | undefined
    let markSpawned: (() => void) | undefined
    const spawned = new Promise<void>((resolve) => { markSpawned = resolve })
    try {
      const ctx = new Context()
      ctx.provide('commands', {
        register: (definition: unknown) => {
          handler = definition as typeof handler
          return () => {}
        },
      })
      ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
      ctx.provide('subagents', {
        async start(_kind: string, _options: unknown) {
          starts += 1
          markSpawned?.()
          // First spawn stays deferred (to hold the scan in flight); later
          // spawns complete immediately so the post-settle re-trigger awaits.
          const plan = { text: 'x', structured: { verdict: 'no_issues', plan: [], notes: [] } }
          if (starts === 1) {
            return {
              result: new Promise((resolve) => {
                resolveRun = () => { resolve(plan) }
              }),
            }
          }
          return { result: Promise.resolve(plan) }
        },
      })
      await ctx.plugin(Commands, { skillsRoot: root, maintainCooldownMs: 0 })
      const first = handler!.handler({ rawInput: 'maintain' }) // pends on the deferred run
      // 0.3.14 (P2-1): the flag is set BEFORE the first await, so a second
      // trigger racing inside the enrich window must already see "running" —
      // the old code exposed two spawns in this window.
      const concurrent = await handler!.handler({ rawInput: 'maintain' })
      expect(concurrent.kind).toBe('success')
      expect(concurrent.text).toContain('already running')
      expect(starts).toBe(0) // first has NOT spawned yet — the window stayed closed
      await spawned // deterministic: wait for the spawn instead of a fixed sleep
      expect(starts).toBe(1)
      const second = await handler!.handler({ rawInput: 'maintain' })
      expect(second.kind).toBe('success')
      expect(second.text).toContain('already running')
      expect(starts).toBe(1) // no second spawn
      resolveRun!()
      const settled = await first
      expect(settled.kind).toBe('success')
      // After settle the same invocation may run again.
      const third = await handler!.handler({ rawInput: 'maintain' })
      expect(third.kind).toBe('success')
      expect(starts).toBe(2)
    } finally {
      if (resolveRun) resolveRun()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('maintain survives a throwing enrichment: flag resets, cooldown updates, no naked reject (0.3.16 S6.1, E-5/E-39)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evo-commands-enrichfail-'))
    const root = join(dir, 'skills')
    await mkdir(root, { recursive: true })
    try {
      const ctx = new Context()
      let handler: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
      ctx.provide('commands', {
        register: (definition: unknown) => {
          handler = definition as typeof handler
          return () => {}
        },
      })
      // A library whose first list() throws models an unreadable skills root —
      // the 0.3.14 shape left the single-flight flag set forever here; every
      // later re-trigger got "already running" with no log.
      ctx.provide('evolutionIo', {
        provider: () => ({
          list: async () => { throw new Error('unreadable library root') },
        }) as unknown as ReturnType<typeof nodeEvolutionIo>,
      })
      ctx.provide('subagents', { async start() { return { result: Promise.resolve({ text: 'x', structured: { verdict: 'no_issues', plan: [], notes: [] } }) } } })
      await ctx.plugin(Commands, { skillsRoot: root, maintainCooldownMs: 60_000 })
      const first = await handler!.handler({ rawInput: 'maintain' })
      expect(first.kind).toBe('error')
      expect(first.text).toContain('Maintenance scan failed')
      // The flag was reset (no "already running") AND the failure updated the
      // cooldown (E-39) — the second trigger is cooldown-blocked, not in-flight-blocked.
      const second = await handler!.handler({ rawInput: 'maintain' })
      expect(second.kind).toBe('success')
      expect(second.text).toContain('cooldown active')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('maintain rejects unknown arguments explicitly instead of falling into help (P3-2)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evo-commands-reject-'))
    const root = join(dir, 'skills')
    await mkdir(join(root, 'demo-skill'), { recursive: true })
    await writeFile(join(root, 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# Demo\n\nbody\n', 'utf8')
    try {
      const ctx = new Context()
      let handler: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
      ctx.provide('commands', {
        register: (definition: unknown) => {
          handler = definition as typeof handler
          return () => {}
        },
      })
      ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
      await ctx.plugin(Commands, { skillsRoot: root, maintainCooldownMs: 0 })
      const unknown = await handler!.handler({ rawInput: 'maintain --foo' })
      expect(unknown.kind).toBe('error')
      expect(unknown.text).toContain('Unknown maintain arguments')
      const equals = await handler!.handler({ rawInput: 'maintain --timeout=600000' })
      expect(equals.kind).toBe('error')
      expect(equals.text).toContain('Unknown maintain arguments')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('preset install composes the runtime standard + delta into the user preset dir (0.3.15)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'evo-commands-preset-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const ctx = new Context()
      let handler: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
      ctx.provide('commands', {
        register: (definition: unknown) => {
          handler = definition as typeof handler
          return () => {}
        },
      })
      ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
      const standardFixture = '- id: agent-loop\n  name: "@deepseek-ai/dsh-agent-loop"\n\n- id: tools\n  name: "@deepseek-ai/dsh-tools"\n'
      ctx.provide('agentPresets', { read: async (id: string) => { if (id !== 'standard') throw new Error(`unknown preset ${id}`); return standardFixture } })
      await ctx.plugin(Commands, { skillsRoot: await mkdtemp(join(tmpdir(), 'evo-commands-preset-skills-')) })
      const result = await handler!.handler({ rawInput: 'preset install' })
      expect(result.kind).toBe('success')
      const target = join(home, '.agent-presets', 'evolution')
      const composed = readFileSync(join(target, 'agent.cordis.yml'), 'utf8')
      // The registry mounts the composition verbatim: the written file is the
      // standard rows + the delta, NEVER the delta alone (0.3.14 defect shape).
      const delta = readFileSync(new URL('../../evolution-agent/agent.cordis.yml', import.meta.url), 'utf8')
      expect(composed).toBe(`${standardFixture.replace(/\s+$/, '')}\n\n${delta.trim()}\n`)
      expect(readFileSync(join(target, 'preset.yml'), 'utf8')).toBe(readFileSync(new URL('../../evolution-agent/preset.yml', import.meta.url), 'utf8'))
      expect(existsSync(join(target, 'preset.yml'))).toBe(true)
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(home, { recursive: true, force: true })
    }
  })

  it('preset install fails loud when delta rows collide with the runtime standard (0.3.15)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'evo-commands-preset-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const ctx = new Context()
      let handler: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
      ctx.provide('commands', {
        register: (definition: unknown) => {
          handler = definition as typeof handler
          return () => {}
        },
      })
      ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
      // A standard that already carries tool-memory would mount the row twice
      // if merged — the composition must refuse instead of shadowing it.
      ctx.provide('agentPresets', { read: async () => '- id: tool-memory\n  name: "@deepseek-ai/dsh-tool-memory"\n' })
      await ctx.plugin(Commands, { skillsRoot: await mkdtemp(join(tmpdir(), 'evo-commands-preset-skills-')) })
      const result = await handler!.handler({ rawInput: 'preset install' })
      expect(result.kind).toBe('error')
      expect(result.text).toContain('collide')
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(home, { recursive: true, force: true })
    }
  })

  it('maintain --facts renders the facts block with zero subagent calls and no cooldown', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evo-commands-facts-'))
    const root = join(dir, 'skills')
    const skillDir = join(root, 'demo-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# Demo\n\n## Run\n\ndo it\n', 'utf8')
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
      ctx.provide('evolutionIo', { provider: () => io })
      let subagentStarts = 0
      ctx.provide('subagents', {
        async start(_kind: string, _options: unknown) {
          subagentStarts += 1
          throw new Error('--facts must never spawn a subagent')
        },
      })
      await ctx.plugin(Commands, { skillsRoot: root })
      const result = await captured!.handler({ rawInput: 'maintain --facts' })
      expect(result.kind).toBe('success')
      expect(result.text).toContain('MECHANICAL_FACTS')
      expect(result.text).toContain('signal=description_chars')
      expect(result.text).toContain('END FACTS')
      expect(subagentStarts).toBe(0)
      // Cooldown is a scan-command guard; a second facts preview must not hit it.
      const second = await captured!.handler({ rawInput: 'maintain --facts' })
      expect(second.kind).toBe('success')
      expect(second.text).toContain('MECHANICAL_FACTS')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('maintain cooldown blocks rapid repeat triggers (single model call)', async () => {
    // Self-contained library (temp root) — a clean CI HOME has no skills and
    // the empty-library short-circuit would skip the subagent, breaking the
    // model-call count assertion.
    const dir = await mkdtemp(join(tmpdir(), 'evo-commands-cooldown-'))
    const root = join(dir, 'skills')
    const skillDir = join(root, 'demo-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# Demo\n\n## Run\n\ndo it\n', 'utf8')
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
      ctx.provide('evolutionIo', { provider: () => io })
      let starts = 0
      const plan = { verdict: 'no_issues', plan: [], notes: [] }
      ctx.provide('subagents', {
        async start(_kind: string, _options: unknown) {
          starts += 1
          return { result: Promise.resolve({ text: 'x', structured: plan }) }
        },
      })
      await ctx.plugin(Commands, { maintainCooldownMs: 60_000, skillsRoot: root })
      const first = await captured!.handler({ rawInput: 'maintain' })
      expect(first.kind).toBe('success')
      expect(starts).toBe(1)
      const second = await captured!.handler({ rawInput: 'maintain' })
      expect(second.kind).toBe('success')
      expect(second.text).toContain('cooldown')
      expect(starts).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('binds the command registration to the fiber so unmount unregisters it (S6.2 E-29)', async () => {
    const registry: Array<{ name: string }> = []
    const register = (definition: unknown): (() => void) => {
      const name = (definition as { name?: string }).name ?? ''
      registry.push({ name })
      return () => {
        const idx = registry.findIndex(item => item.name === name)
        if (idx >= 0) registry.splice(idx, 1)
      }
    }
    const ctx = new Context()
    ctx.provide('commands', { register })
    await ctx.plugin(Commands)
    expect(registry.map(item => item.name)).toEqual(['evolution'])
    // Reload/HMR disposes the fiber; the effect-bound register disposer must
    // run, so a reload can never leave a stale duplicate /evolution behind.
    await ctx.fiber.dispose()
    expect(registry).toHaveLength(0)
  })

  it('preset install commits atomically: a second-file write failure leaves the previous composition usable (S6.3 E-40)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'evo-commands-preset-atomic-'))
    const skillsRoot = await mkdtemp(join(tmpdir(), 'evo-commands-preset-atomic-skills-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const target = join(home, '.agent-presets', 'evolution')
      await mkdir(target, { recursive: true })
      // Seed an existing installation so we can prove it survives an update.
      const oldComposition = 'OLD agent.cordis.yml\n'
      const oldPreset = 'OLD preset.yml\n'
      await writeFile(join(target, 'agent.cordis.yml'), oldComposition, 'utf8')
      await writeFile(join(target, 'preset.yml'), oldPreset, 'utf8')
      // The second staged file collides with a directory, so its write throws
      // EISDIR — a deterministic "second write fails" on Windows and POSIX.
      await mkdir(join(target, 'preset.yml.tmp'))
      const ctx = new Context()
      let handler: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
      ctx.provide('commands', {
        register: (definition: unknown) => {
          handler = definition as typeof handler
          return () => {}
        },
      })
      ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
      const standardFixture = '- id: agent-loop\n  name: "@deepseek-ai/dsh-agent-loop"\n\n- id: tools\n  name: "@deepseek-ai/dsh-tools"\n'
      ctx.provide('agentPresets', { read: async (id: string) => { if (id !== 'standard') throw new Error(`unknown preset ${id}`); return standardFixture } })
      await ctx.plugin(Commands, { skillsRoot })
      const result = await handler!.handler({ rawInput: 'preset install' })
      expect(result.kind).toBe('error')
      expect(result.text).toContain('Preset install failed')
      // The previous composition is untouched — no half-updated preset.
      expect(readFileSync(join(target, 'agent.cordis.yml'), 'utf8')).toBe(oldComposition)
      expect(readFileSync(join(target, 'preset.yml'), 'utf8')).toBe(oldPreset)
      // Neither staged temp leaked.
      expect(existsSync(join(target, 'agent.cordis.yml.tmp'))).toBe(false)
      expect(existsSync(join(target, 'preset.yml.tmp'))).toBe(false)
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(home, { recursive: true, force: true })
      await rm(skillsRoot, { recursive: true, force: true })
    }
  })

  it('help documents the mutations and maintain --facts subcommands (S6.6-1 E-64)', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }>; input?: { hint?: string } } | undefined
    ctx.provide('commands', {
      register: (definition: unknown) => {
        captured = definition as typeof captured
        return () => {}
      },
    })
    await ctx.plugin(Commands)
    // Both the input-declaration hint and the bare /evolution help list the
    // previously-hidden subcommands.
    expect(captured!.input?.hint).toContain('mutations')
    expect(captured!.input?.hint).toContain('--facts')
    const help = await captured!.handler({ rawInput: '' })
    expect(help.kind).toBe('success')
    expect(help.text).toContain('mutations')
    expect(help.text).toContain('maintain [--timeout ms | --facts]')
  })

  it('counts maintain recommendations by the plan bullet, not any string prefix (S6.6-1 E-64)', () => {
    const text = [
      'Maintenance scan abc: verdict=issues (2 recommendations, 1 notes)',
      '- [skill-level] demo-skill · rule=pointer_missing · better rev=patch conf=0.90',
      '  - indented line must not count',
      '- [library-level] all · rule=body_size',
      'Notes:',
      '- this note is a bullet but not a recommendation',
    ].join('\n')
    expect(Commands.countMaintainRecommendations(text)).toBe(2)
    expect(Commands.countMaintainRecommendations(undefined)).toBe(0)
    expect(Commands.countMaintainRecommendations('')).toBe(0)
    expect(Commands.countMaintainRecommendations('no bullets here')).toBe(0)
    // F-365: a note that opens with a bracket must not count as a
    // recommendation — the Notes: section is dropped before counting.
    expect(Commands.countMaintainRecommendations((text.split('Notes:')[0] ?? '') + 'Notes:\n- [note-like] priority reminder')).toBe(2)
  })

  it('pending --detail renders each record with its staged args, truncated and collapsed by default (F-328)', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', {
      register: (definition: unknown) => {
        captured = definition as typeof captured
        return () => {}
      },
    })
    const pendingRecord = {
      id: 'a1', kind: 'skill' as const, status: 'pending' as const, summary: 'create demo',
      args: { operation: { action: 'create', name: 'demo' }, content: 'x'.repeat(700) },
      createdAt: '', origin: 'background_review',
    }
    const executingRecord = {
      id: 'b2', kind: 'memory' as const, status: 'executing' as const, summary: 'remember',
      args: { action: 'add', facts: 'user name ada' }, createdAt: '', origin: 'background_review',
    }
    ctx.provide('evolutionApproval', {
      list: async (status?: string) => status === 'pending' ? [pendingRecord] : status === 'executing' ? [executingRecord] : [],
    })
    await ctx.plugin(Commands)
    const detail = await captured!.handler({ rawInput: 'pending --detail' })
    expect(detail.kind).toBe('success')
    expect(detail.text).toContain('a1  skill  pending  create demo')
    expect(detail.text).toContain('b2  memory  EXECUTING  remember')
    expect(detail.text).toContain('staged args:')
    const argsJson = JSON.stringify(pendingRecord.args)
    // The staged args are rendered (truncated to 500 chars), so the operator
    // can see what approve will actually replay rather than "blind-approving".
    expect(detail.text).toContain(`a1  skill  pending  create demo\n  staged args: ${argsJson.slice(0, 500)}`)
    // Truncation: the full args JSON is NOT rendered (only the 500-char prefix).
    expect(detail.text).not.toContain(argsJson.slice(500))
    // The default (collapsed) view is unchanged: no staged args, and the
    // executing-status marker keeps its trailing-space form.
    const bare = await captured!.handler({ rawInput: 'pending' })
    expect(bare.kind).toBe('success')
    expect(bare.text).toContain('a1  skill  create demo')
    expect(bare.text).toContain('b2  memory  EXECUTING remember')
    expect(bare.text).not.toContain('staged args:')
  })
})
