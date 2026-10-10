import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { emptyRecord, nodeEvolutionIo, presetRowBlock, presetRowId } from '@deepseek-ai/dsh-evolution-core'
import * as Commands from '../src/index.ts'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { tempHome, tempRoot } from '../../test-support/temp-home.ts'
import { captureCommands } from '../../test-support/commands-stub.ts'

/** One row of the family base table (evolution-agent/bases.json) — the SAME table
 * `/evolution preset install` and install-layered.mjs read. */
interface FamilyBase {
  name: string
  id: string
  display: { name: string; description: string; order: number }
}

const FAMILY_BASES = (JSON.parse(readFileSync(new URL('../../evolution-agent/bases.json', import.meta.url), 'utf8')) as { bases: FamilyBase[] }).bases

/** One base-table row by base NAME, or a loud fixture error. */
function familyBase(name: string): FamilyBase {
  const row = FAMILY_BASES.find(candidate => candidate.name === name)
  if (row === undefined) throw new Error(`fixture: bases.json carries no base named "${name}"`)
  return row
}

/** The base composition rows as a platform bundle patch carries them
 * (`packages/bundle/web-app/presets/<base>.patch.yml`: one `insert` entry whose preset row
 * holds the composition under `config.plugins`).
 * @param rows - the base composition's rows at column 0.
 * @returns the patch text.
 */
function basePatchText(rows: string): string {
  const indented = rows.trimEnd().split('\n')
    .map(line => line.trim() === '' ? '' : `          ${line}`)
    .join('\n')
  return `- insert:\n    - id: preset-base\n      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: base\n        plugins:\n${indented}\n`
}

/** Seed one base's platform patch where the resolver reads it: the profile's own
 * `node_modules` candidate (`<profileDir>/node_modules/@deepseek-ai/dsh-web-app/presets/<base>.patch.yml`).
 * @param profileDir - the profile directory the command writes into.
 * @param base - the base name (`standard` / `ptc` / `cordis`).
 * @param rows - the base composition's rows at column 0.
 */
async function seedPlatformBase(profileDir: string, base: string, rows: string): Promise<void> {
  const path = join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets', `${base}.patch.yml`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, basePatchText(rows), 'utf8')
}

/** The profile patch one install writes into (`PROFILE_PATCH_FILENAME`). */
function profilePatchPath(dir: string): string {
  return join(dir, 'cordis.patch.yml')
}

/** The launcher-owned profile facts the command writes through (`profileContext`). */
function profileContext(name: string, dir: string): { name: string; dir: string; patchPath: string; startedBundles: string[] } {
  return { name, dir, patchPath: profilePatchPath(dir), startedBundles: [] }
}

/** Composition rows as they read inside the profile patch: every non-blank line indented under
 * `config.plugins` (6 spaces in the row + 4 for the `- insert:` entry). */
function inPatch(rows: string): string {
  return rows.trim().split('\n').filter(line => line.trim() !== '').map(line => `          ${line}`).join('\n')
}

describe('evolution-commands', () => {
  it('loads without the commands service mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(Commands)
    expect(ctx.get('commands')).toBeUndefined()
  })

  it('dispatches consolidate and skill restore to the curator service', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
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
      history: async (name: string) => {
        calls.push(`history:${name}`)
        return [
          { v: 1, at: '2026-09-27T00:00:00.000Z', action: 'create', hash: 'aaaaaaaaaaaaaaaaaaaa', chars: 42 },
          { v: 2, at: '2026-09-27T00:01:00.000Z', action: 'update', hash: 'bbbbbbbbbbbbbbbbbbbb', chars: 43 },
          // A support file shares the index: it must not read as a version of the body (0.10.1).
          { v: 3, at: '2026-09-27T00:02:00.000Z', action: 'write_file', hash: 'cccccccccccccccccccc', chars: 9 },
        ]
      },
      undo: async (name: string, v?: number) => {
        calls.push(`undo:${name}:${v === undefined ? 'prev' : v}`)
        return { ok: true, message: `Skill "${name}" updated. (undone to v${v ?? 1} — content only)` }
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
    // skill history renders the recorded versions (one line each, oldest first).
    const historyResult = await captured!.handler({ rawInput: 'skill history source-b' })
    expect(historyResult.kind).toBe('success')
    expect(historyResult.text).toContain('Content versions for "source-b" (oldest first, 2 of at most the retained count):')
    expect(historyResult.text).toContain('v1	2026-09-27T00:00:00.000Z	create	42 chars	aaaaaaaaaaaa')
    expect(historyResult.text).toContain('Support-file versions (history only')
    expect(historyResult.text).toContain('v3	2026-09-27T00:02:00.000Z	write_file	9 chars	cccccccccccc')
    // skill undo parses the optional --to (with or without the v prefix) and defaults to "previous".
    const undoTo = await captured!.handler({ rawInput: 'skill undo source-b --to v1' })
    expect(undoTo.kind).toBe('success')
    const undoPrev = await captured!.handler({ rawInput: 'skill undo source-b' })
    expect(undoPrev.kind).toBe('success')
    expect(calls.slice(-3)).toEqual(['history:source-b', 'undo:source-b:1', 'undo:source-b:prev'])
    // Commands runtime contract: handlers must return a CommandResult with kind.
    expect(result.kind).toBe('success')
    expect(restoreResult.kind).toBe('success')
    const missing = await captured!.handler({ rawInput: 'approve some-id' })
    expect(missing.kind).toBe('error')
  })

  // 0.3.80 functional check: a session-less invocation (script / headless probe)
  // reached the learn wake path with no agent and threw a raw TypeError, while
  // every sibling branch answered with a documented E-3xx. Both session-backed
  // branches must ANSWER, never throw.
  it('answers E-305 instead of throwing when the invocation carries no agent', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    await ctx.plugin(Commands)
    const learn = await captured!.handler({ rawInput: 'learn capture the no-agent lesson' })
    expect(learn.kind).toBe('error')
    expect(learn.text).toContain('E-305')
    // restructure answers too: with no io registry it says so (its session is
    // optional now, so it must not dereference the missing agent either).
    const restructure = await captured!.handler({ rawInput: 'restructure demo "## Heading" references/heading.md' })
    expect(restructure.kind).toBe('error')
    expect(restructure.text).toContain('Evolution IO registry not mounted')
  })

  it('V27 G0.5 (U-1): learn delivers through the WAKING channel (followup-first, inject fallback)', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string; agent?: { inject(message: unknown): void; followup?(message: unknown): void } }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    const injected: unknown[] = []
    const followed: unknown[] = []
    await ctx.plugin(Commands)
    // A host that exposes the waking primitive: the prompt must NOT go through
    // `inject` (send 'next-step', wakeup=false) — a slash command opens no turn,
    // so the queued prompt would sit unread until the user wrote something else
    // while the command reported success.
    const wakingAgent = { inject: (message: unknown) => injected.push(message), followup: (message: unknown) => followed.push(message) }
    const withRequest = await captured!.handler({ rawInput: 'learn distill the auth flow from <url>', agent: wakingAgent })
    expect(withRequest.text).toContain('Follow it now')
    expect(injected).toHaveLength(0)
    expect(followed).toHaveLength(1)
    const message = followed[0] as { content: Array<{ text?: string }>; source?: { kind?: string }; role?: string }
    // UserMessage contract: role is required and minted by createUserMessage.
    expect(message.role).toBe('user')
    // 0.2.x: the source kind is the producer's OWN kind (no shared `plugin` field).
    expect(message.source?.kind).toBe('evolution-commands')
    expect(message.content?.[0]?.text).toContain('distill the auth flow from <url>')
    expect(message.content?.[0]?.text).toContain('skill_manage')
    // Empty argument falls back to the "what we just did" guidance.
    const empty = await captured!.handler({ rawInput: 'learn', agent: wakingAgent })
    expect(empty.text).toContain('Follow it now')
    expect((followed[1] as { content: Array<{ text?: string }> }).content?.[0]?.text).toContain('the workflow we just went through')
    // A host without `followup` degrades to inject AND says so honestly —
    // claiming "Follow it now" over a non-waking queue is what the audit
    // flagged as a silent no-op.
    const fallback = await captured!.handler({ rawInput: 'learn check the retry budget', agent: { inject: (message: unknown) => injected.push(message) } })
    expect(fallback.text).toContain('no wake-up channel')
    expect(fallback.text).not.toContain('Follow it now')
    expect(injected).toHaveLength(1)
  })

  it('0.3.73: learn calls the wake primitive ON the agent (a prototype method keeps its receiver)', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    await ctx.plugin(Commands)
    const followed: unknown[] = []
    // The platform Agent is a CLASS whose `followup` is a prototype method that
    // calls `this.send(...)`; the object-literal stub in the case above is a
    // bound arrow property, so it stayed green while the 0.3.68 form
    // (`const followup = agent.followup; followup(message)`) threw on every real
    // learn and queued nothing.
    class PlatformLikeAgent {
      readonly injected: unknown[] = []
      followup(message: unknown): void { this.record(message) }
      inject(message: unknown): void { this.injected.push(message) }
      private record(message: unknown): void { followed.push(message) }
    }
    const agent = new PlatformLikeAgent()
    const result = await captured!.handler({ rawInput: 'learn capture the wake-path lesson', agent })
    expect(result.text).toContain('Follow it now')
    expect(followed).toHaveLength(1)
    expect(agent.injected).toHaveLength(0)
    const message = followed[0] as { role?: string; content?: Array<{ text?: string }> }
    expect(message.role).toBe('user')
    expect(message.content?.[0]?.text).toContain('capture the wake-path lesson')
  })

  it('skills health renders degraded structure rows or a clean verdict (rc.73 A1)', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
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
    const home = await tempHome('dsh-cmd-learn-event-')
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string; agent?: { inject(message: unknown): void } }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
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
  })

  it('curator scope renders the lifecycle lists including quality-warned', async () => {    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
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
    expect(result.text).toContain('Protected (pinned / bundled / hub / builtin): 1')
  })

  it('restore dispatches the full-state snapshot restore to the curator', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    const calls: string[] = []
    ctx.provide('evolutionCurator', {
      restoreSnapshot: async () => {
        calls.push('restoreSnapshot')
        return { ok: true, message: 'Restored skill tree from /path' }
      },
    })
    await ctx.plugin(Commands)
    // P2-11 (v19): an unexpected tail is REFUSED — the v11 shape silently ran a
    // whole-tree rollback, so `/evolution restore <name>` (a missing `skill `
    // prefix) triggered the destructive path by accident.
    const rejected = await captured!.handler({ rawInput: 'restore snap' })
    expect(rejected.kind).toBe('error')
    expect(rejected.text).toContain('takes no arguments')
    expect(calls).toEqual([])
    const result = await captured!.handler({ rawInput: 'restore' })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('Restored skill tree from /path')
    expect(calls).toEqual(['restoreSnapshot'])
    // P0-2 (v11): the BARE `restore` (registry/README documented usage) must
    // also reach the snapshot restorer — it used to fall into the help branch.
    await captured!.handler({ rawInput: 'restore' })
    expect(calls).toEqual(['restoreSnapshot', 'restoreSnapshot'])
  })
  it('dispatches curator pause/resume/status to the curator service (G2)', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
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

    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))

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
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
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
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
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

  it('restructure succeeds end-to-end on a temp library via Config.root', async () => {
    const dir = await tempRoot('evo-commands-restructure-')
    const root = join(dir, 'skills')
    const skillDir = join(root, 'demo-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill for restructure tests.\n---\n\n# Demo\n\n## Log\n\nold detail\n\n## Keep\n\nnew\n', 'utf8')
    const ctx = new Context()
    // V8-08 (0.3.47): the command's restructure now wires the single
    // write-sink so the skill-catalog cache invalidation event fires.
    let mutatedEvent: unknown
    ctx.on('evolution/skill-mutated', (event) => { mutatedEvent = event })
    // V9-12 (0.3.51): the OTHER half of the V8-08 discipline — the
    // skillUsage.record(...) observation — must be asserted too (an
    // event-only assertion let a removed record() line pass silently).
    const usageRecords: Array<[string, string]> = []
    ctx.provide('skillUsage', {
      record: async (name: string, kind: string) => { usageRecords.push([name, kind]) },
    })
    let captured: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    const io = nodeEvolutionIo()
    ctx.provide('evolutionIo', {
      provider: () => io,
    })
    // Config.root is the command-facing root (A7 alignment) — the
    // temp root keeps the mutation off the real library.
    await ctx.plugin(Commands, { root: root })
    const result = await captured!.handler({ rawInput: 'restructure demo-skill "Log" references/log.md' })
    expect(result.kind).toBe('success')
    expect(mutatedEvent).toEqual(expect.objectContaining({ action: 'restructure', name: 'demo-skill' }))
    expect(usageRecords).toEqual([['demo-skill', 'patch']])
    const body = await io.readText(join(skillDir, 'SKILL.md'))
    expect(body).not.toContain('old detail')
    expect(body).toContain('references/log.md')
    const support = await io.readText(join(root, 'demo-skill', 'references', 'log.md'))
    expect(support).toContain('old detail')
  })

  /** A captured command handler, as these fixtures build it. */
  type Handler = { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> }

  /** 0.19.0 (S2): `/evolution maintain` answers with a POINTER — a test reads the
   * outcome from the new surface instead of the command's text. Extracts the run id
   * from the reply, then polls `maintain status <id>` until the run is terminal. */
  async function settleMaintain(handler: Handler, started: { text: string }): Promise<string> {
    const id = /Maintenance run (\S+) started/.exec(started.text)?.[1]
    expect(id, `the command names its run: ${started.text}`).toBeTruthy()
    for (let attempt = 0; attempt < 500; attempt++) {
      const status = await handler.handler({ rawInput: `maintain status ${id}` })
      if (!/\srunning\s/.test(status.text)) return id as string
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error(`maintenance run ${id} never settled`)
  }

  it('maintain enriches support files and reports pointer_missing truthfully (v11 P1-1)', async () => {
    // tempHome, not tempRoot: the run registry and the report live under the
    // evolution home now, and a test must not write into the real one.
    const dir = await tempHome('evo-commands-enrich-')
    const root = join(dir, 'skills')
    const skillDir = join(root, 'demo-skill')
    await mkdir(join(skillDir, 'references'), { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# Demo\n\n## Run\n\ndo it\n', 'utf8')
    await writeFile(join(skillDir, 'references', 'notes.md'), '# notes\n', 'utf8')
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    const io = nodeEvolutionIo()
    ctx.provide('evolutionIo', { provider: () => io })
    let capturedPrompt = ''
    ctx.provide('subagents', {
      async start(_kind: string, options: unknown) {
        const opts = options as { prompt?: Array<{ text: string }> }
        capturedPrompt = opts.prompt?.[0]?.text ?? ''
        return {
          // V24-19 (v24): the no-action output must name the over signal in
          // a note — pointer_missing=over is in the facts block, so an
          // unexplained no_issues is refused by the §3 completeness gate.
          result: Promise.resolve({ text: 'x', structured: { verdict: 'no_issues', plan: [], notes: ['pointer_missing: references/notes.md intentionally unlinked in this fixture; no action needed'] } }),
        }
      },
    })
    await ctx.plugin(Commands, { root: root })
    const started = await captured!.handler({ rawInput: 'maintain' })
    expect(started.kind).toBe('success')
    expect(started.text).toContain('keeps running after this reply')
    const runId = await settleMaintain(captured!, started)
    // The plan lives in the run's REPORT (the command only points at it).
    const report = await captured!.handler({ rawInput: `maintain report ${runId}` })
    expect(report.kind).toBe('success')
    // Enriched facts: the unlinked support file is reported as a real over,
    // never a fabricated pass/unknown.
    expect(capturedPrompt).toContain('signal=pointer_missing')
    expect(capturedPrompt).toMatch(/signal=pointer_missing value=references\/notes\.md verdict=over/)
    expect(capturedPrompt).toContain('signal=description_chars')
    expect(capturedPrompt).toContain('signal=usage_observed')
  })

  it('maintain --timeout overrides the subagent deadline for this run (0.3.4)', async () => {
    const dir = await tempHome('evo-commands-timeout-')
    const root = join(dir, 'skills')
    // A non-empty library: runMaintain short-circuits an EMPTY library before
    // the subagent start (so the signal capture below would stay undefined).
    await mkdir(join(root, 'demo-skill'), { recursive: true })
    await writeFile(join(root, 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# Demo\n\nbody\n', 'utf8')
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
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
    await ctx.plugin(Commands, { root: root, maintainCooldownMs: 0 })
    const bad = await captured!.handler({ rawInput: 'maintain --timeout 0' })
    expect(bad.kind).toBe('error')
    expect(bad.text).toContain('Invalid --timeout')
    const good = await captured!.handler({ rawInput: 'maintain --timeout 600000' })
    expect(good.kind).toBe('success')
    // The spawn happens inside the detached run: wait for it instead of assuming
    // the command awaited it.
    for (let attempt = 0; attempt < 500 && capturedSignal === undefined; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
    expect(capturedSignal).toBeTruthy()
  })

  it('single-flight: a re-trigger during a running scan returns already-running and does not spawn (0.3.11)', async () => {
    const dir = await tempHome('evo-commands-singleflight-')
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
      ctx.provide('commands', captureCommands((definition) => { handler = definition as typeof handler }))
      ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
      ctx.provide('subagents', {
        async start(_kind: string, _options: unknown) {
          starts += 1
          markSpawned?.()
          // First spawn stays deferred (to hold the scan in flight); later
          // spawns complete immediately so the post-settle re-trigger awaits.
          const plan = { text: 'x', output: [], stopReason: 'completed' as const, structured: { verdict: 'no_issues', plan: [], notes: [] } }
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
      await ctx.plugin(Commands, { root: root, maintainCooldownMs: 0 })
      const started = await handler!.handler({ rawInput: 'maintain' }) // answers immediately now; the scan stays in flight
      // 0.3.14 (P2-1): the flag is set BEFORE the first await, so a second
      // trigger racing inside the enrich window must already see "running" —
      // the old code exposed two spawns in this window.
      // V10-08 (F-04): the refusal is now kind:'error' (a refused scan is not
      // a successful scan).
      const concurrent = await handler!.handler({ rawInput: 'maintain' })
      expect(concurrent.kind).toBe('error')
      expect(concurrent.text).toContain('already running')
      expect(starts).toBe(0) // first has NOT spawned yet — the window stayed closed
      await spawned // deterministic: wait for the spawn instead of a fixed sleep
      expect(starts).toBe(1)
      const second = await handler!.handler({ rawInput: 'maintain' })
      expect(second.kind).toBe('error')
      expect(second.text).toContain('already running')
      expect(starts).toBe(1) // no second spawn
      resolveRun!()
      await settleMaintain(handler!, started)
      // After the run settles the same invocation may run again.
      const third = await handler!.handler({ rawInput: 'maintain' })
      expect(third.kind).toBe('success')
      for (let attempt = 0; attempt < 500 && starts < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
      expect(starts).toBe(2)
    } finally {
      if (resolveRun) resolveRun()
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('maintain survives a throwing enrichment: flag resets, cooldown updates, no naked reject (0.3.16 S6.1, E-5/E-39)', async () => {
    const dir = await tempHome('evo-commands-enrichfail-')
    const root = join(dir, 'skills')
    await mkdir(root, { recursive: true })
    const ctx = new Context()
    let handler: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { handler = definition as typeof handler }))
    // A library whose first list() throws models an unreadable skills root —
    // the 0.3.14 shape left the single-flight flag set forever here; every
    // later re-trigger got "already running" with no log.
    ctx.provide('evolutionIo', {
      provider: () => ({
        list: async () => { throw new Error('unreadable library root') },
      }) as unknown as ReturnType<typeof nodeEvolutionIo>,
    })
    ctx.provide('subagents', { async start() { return { result: Promise.resolve({ text: 'x', structured: { verdict: 'no_issues', plan: [], notes: [] } }) } } })
    await ctx.plugin(Commands, { root: root, maintainCooldownMs: 60_000 })
    // 0.19.0 (S2): the command answers before the scan runs, so the failure is in
    // the RUN (readable later), not in the command's result — the shape that left
    // the single-flight flag stuck in 0.3.14 is structurally gone.
    const started = await handler!.handler({ rawInput: 'maintain' })
    expect(started.kind).toBe('success')
    const runId = await settleMaintain(handler!, started)
    const status = await handler!.handler({ rawInput: `maintain status ${runId}` })
    expect(status.text).toContain('failed')
    expect(status.text).toContain('Maintenance scan failed')
    // No report was written (the run died before the plan): the reader says
    // "no result" instead of rendering an empty plan (three-state honesty).
    const report = await handler!.handler({ rawInput: `maintain report ${runId}` })
    expect(report.kind).toBe('error')
    // The fixture's io cannot even answer a read, so the reader lands on the
    // "unreadable" branch rather than "no result" — what matters is that NEITHER
    // of them renders as an empty plan.
    expect(report.text).toMatch(/has NO result|could not be read/)
    // The flag was reset (no "already running") AND the failure updated the
    // cooldown (E-39) — the second trigger is cooldown-blocked, not
    // in-flight-blocked. V10-08 (F-04): cooldown-blocked is kind:'error'.
    const second = await handler!.handler({ rawInput: 'maintain' })
    expect(second.kind).toBe('error')
    expect(second.text).toContain('cooldown active')
  })

  it('maintain grammar: unknown args rejected explicitly; = and multi-space timeout forms accepted (P3-2, F-03)', async () => {
    const dir = await tempHome('evo-commands-reject-')
    const root = join(dir, 'skills')
    await mkdir(join(root, 'demo-skill'), { recursive: true })
    await writeFile(join(root, 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# Demo\n\nbody\n', 'utf8')
    const ctx = new Context()
    let handler: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { handler = definition as typeof handler }))
    ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
    ctx.provide('subagents', {
      async start(_kind: string, _options: unknown) {
        return { result: Promise.resolve({ text: 'x', structured: { verdict: 'no_issues', plan: [], notes: [] } }) }
      },
    })
    await ctx.plugin(Commands, { root: root, maintainCooldownMs: 0 })
    const unknown = await handler!.handler({ rawInput: 'maintain --foo' })
    expect(unknown.kind).toBe('error')
    expect(unknown.text).toContain('Unknown maintain arguments')
    // F-03: the `=` spelling and multi-space separators pass the
    // grammar now (previously "Unknown maintain arguments" rejections).
    const equals = await handler!.handler({ rawInput: 'maintain --timeout=600000' })
    expect(equals.kind).toBe('success')
    // Each trigger now starts a RUN: let it settle before the next one, or the
    // next call is refused as "already running" (which is its own test).
    await settleMaintain(handler!, equals)
    const spaced = await handler!.handler({ rawInput: 'maintain   --timeout 600000' })
    expect(spaced.kind).toBe('success')
  })

  it('preset install composes the runtime standard + delta into the profile patch row (0.3.15)', async () => {
    const home = await tempHome('evo-commands-preset-')
    const profileDir = join(home, 'profiles', 'web')
    const ctx = new Context()
    let handler: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { handler = definition as typeof handler }))
    ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
    // 0.2.x: the base is the bundle patch layer that declares the platform's own
    // preset (`packages/bundle/web-app/presets/standard.patch.yml`), resolved from
    // the profile's own node_modules. 0.3.53: it carries a tool-skill row so the
    // /evolution preset install path is proven to inject the V10-14 cap — the npm
    // user's ONLY preset generation path (install-layered is the source-tree tool),
    // and P1-2's symptom lived here before this batch.
    const standardFixture = '- id: agent-loop\n  name: "@deepseek-ai/dsh-agent-loop"\n\n- id: tools\n  name: "@deepseek-ai/dsh-tools"\n\n- id: tool-skill\n  name: "@deepseek-ai/dsh-tool-skill"\n'
    await seedPlatformBase(profileDir, 'standard', standardFixture)
    // The launcher-owned profile facts: the row lands in THIS profile's own patch
    // layer — the file the platform's Web editor also saves preset edits to.
    const patchPath = profilePatchPath(profileDir)
    ctx.provide('profileContext', profileContext('web', profileDir))
    await ctx.plugin(Commands, { root: await mkdtemp(join(tmpdir(), 'evo-commands-preset-skills-')) })
    const result = await handler!.handler({ rawInput: 'preset install' })
    expect(result.kind).toBe('success')
    expect(result.text).toContain(patchPath)
    const patch = readFileSync(patchPath, 'utf8')
    // The delivered artifact is ONE `- insert:` entry carrying the declarative row:
    // `- insert:` is what ADDS a row (a plain entry only overrides the same id).
    expect(patch).toContain("- insert:\n    - id: preset-evolution\n      name: '@deepseek-ai/dsh-agent-preset'\n")
    // The registry mounts the row's plugin list verbatim: the standard rows + the
    // delta, NEVER the delta alone (0.3.14 defect shape).
    const delta = readFileSync(new URL('../../evolution-agent/agent.cordis.yml', import.meta.url), 'utf8')
    expect(patch).toContain('          - id: agent-loop\n            name: "@deepseek-ai/dsh-agent-loop"')
    expect(patch).toContain('          - id: tools\n            name: "@deepseek-ai/dsh-tools"')
    expect(patch).toContain(inPatch(delta))
    // V10-14 cap injection rides the composer (0.3.53) — the generated
    // preset-scope tool-skill row carries the 60-char cap.
    expect(patch).toContain('          - id: tool-skill\n            name: "@deepseek-ai/dsh-tool-skill"\n            # V10-14')
    expect(patch).toContain('catalogDescriptionMaxLength: 60')
    // A3 → 0.2.x: the display metadata is a LITERAL inside the row (the picker
    // localizes the platform's own shipped ids only), so the variant lists under its
    // published name instead of the bare id. The four preset*.yml metadata files have
    // no reader on this line — there is no second filename to disagree about.
    const standard = familyBase('standard')
    expect(patch).toContain(`        id: evolution\n        name: ${JSON.stringify(standard.display.name)}\n        description: ${JSON.stringify(standard.display.description)}\n        order: ${standard.display.order}`)
    // The directory mechanism is gone: nothing lands under `.agent-presets`.
    expect(existsSync(join(home, '.agent-presets'))).toBe(false)
  })

  it('preset install --base ptc writes the ptc variant from the shared base table (0.3.75)', async () => {
    const home = await tempHome('evo-commands-preset-ptc-')
    const profileDir = join(home, 'profiles', 'web')
    const ctx = new Context()
    let handler: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { handler = definition as typeof handler }))
    ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
    // The base table is evolution-agent/bases.json — the SAME file
    // install-layered.mjs reads. The npm path used to hardcode `standard`, so
    // the ptc variant was unreachable here; the base NAME selects the platform patch.
    const platformFixture = '- id: tools\n  name: "@deepseek-ai/dsh-tools"\n  config:\n    mode: ptc\n'
    await seedPlatformBase(profileDir, 'ptc', platformFixture)
    const patchPath = profilePatchPath(profileDir)
    ctx.provide('profileContext', profileContext('web', profileDir))
    await ctx.plugin(Commands, { root: await mkdtemp(join(tmpdir(), 'evo-commands-preset-skills-')) })
    const result = await handler!.handler({ rawInput: 'preset install --base ptc' })
    expect(result.kind).toBe('success')
    const patch = readFileSync(patchPath, 'utf8')
    // The ptc variant is its OWN row id, composed from the ptc base patch.
    expect(patch).toContain('    - id: preset-evolution-ptc\n')
    expect(patch).toContain('          - id: tools\n            name: "@deepseek-ai/dsh-tools"\n            config:\n              mode: ptc')
    expect(patch).not.toContain('          - id: agent-loop')
    // A3 (audit P1-3) → 0.2.x: the variant's display metadata travels as LITERALS
    // inside the row, the only place the picker reads it. The former behavior wrote
    // a metadata file under a name the platform never reads (so the picker showed the
    // bare id with no description/order); on this line there is no metadata file and
    // no second filename to disagree about.
    const ptc = familyBase('ptc')
    expect(patch).toContain(`        id: evolution-ptc\n        name: ${JSON.stringify(ptc.display.name)}\n        description: ${JSON.stringify(ptc.display.description)}\n        order: ${ptc.display.order}`)
    const unknown = await handler!.handler({ rawInput: 'preset install --base nonsense' })
    expect(unknown.kind).toBe('error')
    expect(unknown.text).toContain('bases.json')
  })

  it('preset install --base standard,ptc writes BOTH rows, and a typo writes NEITHER (v41)', async () => {
    const home = await tempHome('evo-commands-preset-multi-')
    const profileDir = join(home, 'profiles', 'web')
    const ctx = new Context()
    let handler: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { handler = definition as typeof handler }))
    ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
    // One platform base patch per base, so a variant composed from the WRONG
    // base is visible in the written row.
    const fixtures: Record<string, string> = {
      standard: '- id: agent-loop\n  name: "@deepseek-ai/dsh-agent-loop"\n',
      ptc: '- id: tools\n  name: "@deepseek-ai/dsh-tools"\n  config:\n    mode: ptc\n',
    }
    await seedPlatformBase(profileDir, 'standard', fixtures.standard as string)
    await seedPlatformBase(profileDir, 'ptc', fixtures.ptc as string)
    const patchPath = profilePatchPath(profileDir)
    ctx.provide('profileContext', profileContext('web', profileDir))
    await ctx.plugin(Commands, { root: await mkdtemp(join(tmpdir(), 'evo-commands-preset-multi-skills-')) })
    const result = await handler!.handler({ rawInput: 'preset install --base standard,ptc' })
    expect(result.kind).toBe('success')
    const patch = readFileSync(patchPath, 'utf8')
    // Each variant composes ITS OWN platform base patch, in table order.
    expect(patch).toContain('          - id: agent-loop\n            name: "@deepseek-ai/dsh-agent-loop"')
    expect(patch).toContain('          - id: tools\n            name: "@deepseek-ai/dsh-tools"\n            config:\n              mode: ptc')
    expect(patch.indexOf('    - id: preset-evolution\n')).toBeLessThan(patch.indexOf('    - id: preset-evolution-ptc\n'))
    // The standard row must not carry the ptc base's composition.
    expect(presetRowBlock(patch, presetRowId('evolution'))).not.toContain('mode: ptc')
    expect(presetRowBlock(patch, presetRowId('evolution-ptc'))).toContain('mode: ptc')

    // Every name is resolved before anything is written: the typo aborts the
    // whole request and the two healthy rows stay exactly as they were.
    const before = readFileSync(patchPath, 'utf8')
    const typo = await handler!.handler({ rawInput: 'preset install --base standard,ptc,nonsense' })
    expect(typo.kind).toBe('error')
    expect(typo.text).toContain('nonsense')
    expect(readFileSync(patchPath, 'utf8')).toBe(before)
  })

  it('G1-② (0.3.78): refuses an unsupported base and one whose required service is absent', async () => {
    // The installer refuses the same two cases from the same table; the command
    // asks the runtime for the service itself, which is exactly the reason a
    // mount would refuse. Both paths must agree, or one of them generates a
    // preset that cannot mount. tempHome FIRST: the E-33 conflict sweep reads
    // the real DSH_HOME otherwise, and this machine's web profile carries the
    // evolution-all bundle — every other preset-install case in this file does
    // the same for the same reason.
    const home = await tempHome('evo-commands-ability-')
    const profileDir = join(home, 'profiles', 'web')
    const ctx = new Context()
    let handler: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { handler = definition as typeof handler }))
    ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
    await seedPlatformBase(profileDir, 'cordis', '- id: persona\n- id: tool-skill\n')
    const patchPath = profilePatchPath(profileDir)
    ctx.provide('profileContext', profileContext('web', profileDir))
    await ctx.plugin(Commands, { root: await mkdtemp(join(tmpdir(), 'evo-commands-ability-skills-')) })
    const unsupported = await handler!.handler({ rawInput: 'preset install --base minimal' })
    expect(unsupported.kind).toBe('error')
    expect(unsupported.text).toContain('UNSUPPORTED')
    const missing = await handler!.handler({ rawInput: 'preset install --base cordis' })
    expect(missing.kind).toBe('error')
    expect(missing.text).toContain('dynamicCordisRunner')
    ctx.provide('dynamicCordisRunner', {})
    const allowed = await handler!.handler({ rawInput: 'preset install --base cordis' })
    expect(allowed.kind).toBe('success')
    expect(readFileSync(patchPath, 'utf8')).toContain('    - id: preset-evolution-cordis\n')
  })

  it('preset install fails loud when delta rows collide with the runtime standard (0.3.15)', async () => {
    const home = await tempHome('evo-commands-preset-')
    const profileDir = join(home, 'profiles', 'web')
    const ctx = new Context()
    let handler: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { handler = definition as typeof handler }))
    ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
    // A standard base that already carries tool-memory would mount the row twice
    // if merged — the composition must refuse instead of shadowing it.
    await seedPlatformBase(profileDir, 'standard', '- id: tool-memory\n  name: "@deepseek-ai/dsh-tool-memory"\n')
    const patchPath = profilePatchPath(profileDir)
    ctx.provide('profileContext', profileContext('web', profileDir))
    await ctx.plugin(Commands, { root: await mkdtemp(join(tmpdir(), 'evo-commands-preset-skills-')) })
    const result = await handler!.handler({ rawInput: 'preset install' })
    expect(result.kind).toBe('error')
    expect(result.text).toContain('collide')
    // The refusal happens before any write: a refused install leaves no artifact behind.
  })

  it('review P1-1: a run another process is running blocks a second start and cannot be cancelled here', async () => {
    const dir = await tempHome('evo-commands-crossplane-')
    const root = join(dir, 'skills')
    await mkdir(join(root, 'demo-skill'), { recursive: true })
    await writeFile(join(root, 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# Demo\n\nbody\n', 'utf8')
    // The other plane's live run: a running record whose owner process is alive.
    const runsPath = join(dir, 'evolution', 'runs.json')
    await mkdir(join(dir, 'evolution'), { recursive: true })
    await writeFile(runsPath, JSON.stringify({
      schemaVersion: 1,
      runs: [{ id: 'other-plane-run', kind: 'maintain', state: 'running', startedAt: Date.now(), pid: process.pid }],
    }), 'utf8')
    const ctx = new Context()
    let handler: Handler | undefined
    ctx.provide('commands', captureCommands((definition) => { handler = definition as Handler }))
    ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
    let starts = 0
    ctx.provide('subagents', { async start() { starts += 1; return { result: Promise.resolve({ text: 'x', structured: { verdict: 'no_issues', plan: [], notes: [] } }) } } })
    await ctx.plugin(Commands, { root: root, maintainCooldownMs: 0 })
    // The guard sees it (one scan per home, across planes), and says who owns it.
    const refused = await handler!.handler({ rawInput: 'maintain' })
    expect(refused.kind).toBe('error')
    expect(refused.text).toContain('already running')
    expect(refused.text).toContain('other-plane-run')
    expect(starts, 'no second scan was spawned').toBe(0)
    const status = await handler!.handler({ rawInput: 'maintain status' })
    expect(status.text, 'status sees the other plane in flight').toContain('other-plane-run')
    expect(status.text).toContain('running')
    const cancel = await handler!.handler({ rawInput: 'maintain cancel other-plane-run' })
    expect(cancel.kind).toBe('error')
    expect(cancel.text).toContain('ANOTHER process')
    // The refresh is what makes this work for a run that appears AFTER this plane
    // mounted (the mount-time load cannot see the future): write a new live record
    // and the very next command must notice it.
    await writeFile(runsPath, JSON.stringify({
      schemaVersion: 1,
      runs: [
        { id: 'other-plane-run', kind: 'maintain', state: 'succeeded', startedAt: Date.now() - 60_000, endedAt: Date.now() - 59_000 },
        { id: 'started-later', kind: 'maintain', state: 'running', startedAt: Date.now(), pid: process.pid },
      ],
    }), 'utf8')
    const refusedAgain = await handler!.handler({ rawInput: 'maintain' })
    expect(refusedAgain.kind).toBe('error')
    expect(refusedAgain.text).toContain('started-later')
    expect(starts, 'still no scan of our own').toBe(0)
  })

  it('review P2-1: an unreadable run history is not reported as "no runs"', async () => {
    const dir = await tempHome('evo-commands-badindex-')
    const root = join(dir, 'skills')
    await mkdir(root, { recursive: true })
    await mkdir(join(dir, 'evolution'), { recursive: true })
    await writeFile(join(dir, 'evolution', 'runs.json'), 'not json', 'utf8')
    const ctx = new Context()
    let handler: Handler | undefined
    ctx.provide('commands', captureCommands((definition) => { handler = definition as Handler }))
    ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
    ctx.provide('subagents', { async start() { return { result: Promise.resolve({ text: 'x', structured: { verdict: 'no_issues', plan: [], notes: [] } }) } } })
    await ctx.plugin(Commands, { root: root, maintainCooldownMs: 0 })
    const status = await handler!.handler({ rawInput: 'maintain status' })
    expect(status.kind).toBe('error')
    expect(status.text).toContain('not readable')
    expect(status.text).toContain('NOT "no runs"')
    expect(status.text, 'the empty-history line must not answer this').not.toContain('No maintenance run recorded')
  })

  it('review P2-2: a run with no report answers "has NO result" (the missing branch, on a real io)', async () => {
    const dir = await tempHome('evo-commands-noresult-')
    const root = join(dir, 'skills')
    await mkdir(join(root, 'demo-skill'), { recursive: true })
    await writeFile(join(root, 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# Demo\n\nbody\n', 'utf8')
    const ctx = new Context()
    let handler: Handler | undefined
    ctx.provide('commands', captureCommands((definition) => { handler = definition as Handler }))
    ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
    ctx.provide('subagents', { async start() { return { result: Promise.resolve({ text: 'x', output: [], stopReason: 'completed' as const, structured: { verdict: 'no_issues', plan: [], notes: [] } }) } } })
    await ctx.plugin(Commands, { root: root, maintainCooldownMs: 0 })
    const started = await handler!.handler({ rawInput: 'maintain' })
    expect(started.kind).toBe('success')
    const runId = await settleMaintain(handler!, started)
    // The run succeeded and wrote its report; the RESULT is then removed (an operator,
    // a cleanup, a different home) — the reader must say "no result", not render empty.
    await rm(join(dir, 'evolution', 'reports', `maintain-${runId}.json`), { force: true })
    await rm(join(dir, 'evolution', 'reports', `maintain-${runId}.md`), { force: true })
    const report = await handler!.handler({ rawInput: `maintain report ${runId}` })
    expect(report.kind).toBe('error')
    expect(report.text).toContain('has NO result')
    expect(report.text, 'the unreadable branch must not answer this').not.toContain('could not be read')
  })
})
