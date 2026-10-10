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
    expect(existsSync(patchPath)).toBe(false)
  })

  it('maintain --facts renders the facts block with zero subagent calls and no cooldown', async () => {
    const dir = await tempRoot('evo-commands-facts-')
    const root = join(dir, 'skills')
    const skillDir = join(root, 'demo-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# Demo\n\n## Run\n\ndo it\n', 'utf8')
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    const io = nodeEvolutionIo()
    ctx.provide('evolutionIo', { provider: () => io })
    let subagentStarts = 0
    ctx.provide('subagents', {
      async start(_kind: string, _options: unknown) {
        subagentStarts += 1
        throw new Error('--facts must never spawn a subagent')
      },
    })
    await ctx.plugin(Commands, { root: root })
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
  })

  it('T3-02/A30: maintain --facts ages the skill through the shared enrichment — the retire line the probe must agree with', async () => {
    const dir = await tempRoot('evo-commands-facts-liveness-')
    const root = join(dir, 'skills')
    const skillDir = join(root, 'demo-skill')
    await mkdir(join(skillDir, 'references'), { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# Demo\n\nbody without a support-file mention\n', 'utf8')
    await writeFile(join(skillDir, 'references', 'dead.md'), 'never read\n', 'utf8')
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
    // Same fixture shape as the probe spec (evolution-maintenance tools.spec.ts): an observed read
    // (the demand window is open) plus an old activity anchor (past the stale window).
    const old = new Date(2021, 0, 1).toISOString()
    ctx.provide('skillUsage', {
      report: async () => new Map([['demo-skill', { ...emptyRecord(), view_count: 1, created_at: old, last_used_at: old }]]),
    })
    await ctx.plugin(Commands, { root })
    const result = await captured!.handler({ rawInput: 'maintain --facts' })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('never read: references/dead.md')
    // T3-02/A30: the facts block is the reference answer the probe must match; before the shared
    // mapping the probe answered `retire: age unknown` for this very tree.
    expect(result.text).toContain('retire≥30d: references/dead.md(')
    expect(result.text).not.toContain('retire: age unknown')
  })

  it('maintain --facts reports a misconfigured root like the full scan instead of clean facts (S5.4 audit P2-22)', async () => {
    // The io seam lists a MISSING root as an empty directory, so the preview
    // used to render the clean empty-library facts block and return success
    // while the full scan answered M-02 ("the configured skill root does not
    // exist"). The preview must reach the SAME conclusion, not a fake clean
    // bill.
    const dir = await tempRoot('evo-commands-facts-missing-root-')
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
    // `skills` is deliberately never created: root points at a directory that
    // does not exist.
    await ctx.plugin(Commands, { root: join(dir, 'skills') })
    const result = await captured!.handler({ rawInput: 'maintain --facts' })
    expect(result.kind).toBe('error')
    expect(result.text).toContain('the configured skill root does not exist')
    expect(result.text).toContain(join(dir, 'skills'))
    expect(result.text).not.toContain('MECHANICAL_FACTS')
  })

  it('maintain --facts answers a healthy but empty library exactly like the full scan (PLAN-R2 P2-10)', async () => {
    // Cause 3 of orchestrate's empty-snapshot discrimination: the root exists
    // and lists nothing. The full scan short-circuits with the plain text
    // "Maintenance scan: empty skill library. Nothing to do." and no facts
    // block; the preview used to render an empty MECHANICAL_FACTS block
    // instead — disagreeing with the very scan it previews.
    const dir = await tempRoot('evo-commands-facts-empty-')
    const root = join(dir, 'skills')
    await mkdir(root, { recursive: true })
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
    await ctx.plugin(Commands, { root })
    const result = await captured!.handler({ rawInput: 'maintain --facts' })
    expect(result.kind).toBe('success')
    expect(result.text).toBe('Maintenance scan: empty skill library. Nothing to do.')
    expect(result.text).not.toContain('MECHANICAL_FACTS')
  })

  it('maintain cooldown blocks rapid repeat triggers (single model call)', async () => {
    // Self-contained library (temp root) — a clean CI HOME has no skills and
    // the empty-library short-circuit would skip the subagent, breaking the
    // model-call count assertion.
    const dir = await tempHome('evo-commands-cooldown-')
    const root = join(dir, 'skills')
    const skillDir = join(root, 'demo-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# Demo\n\n## Run\n\ndo it\n', 'utf8')
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
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
    await ctx.plugin(Commands, { maintainCooldownMs: 60_000, root: root })
    const first = await captured!.handler({ rawInput: 'maintain' })
    expect(first.kind).toBe('success')
    // The cooldown window starts when a run SETTLES (registry), so the first run
    // must finish before the second trigger can be cooldown-blocked rather than
    // in-flight-blocked.
    await settleMaintain(captured!, first)
    expect(starts).toBe(1)
    // V10-08 (F-04): the cooldown refusal is kind:'error' now.
    const second = await captured!.handler({ rawInput: 'maintain' })
    expect(second.kind).toBe('error')
    expect(second.text).toContain('cooldown')
    expect(starts).toBe(1)
  })

  it('0.19.0 (S2): status answers in flight and after settle, and report hands back the plan', async () => {
    const dir = await tempHome('evo-commands-runstatus-')
    const root = join(dir, 'skills')
    await mkdir(join(root, 'demo-skill'), { recursive: true })
    await writeFile(join(root, 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# Demo\n\nbody\n', 'utf8')
    const ctx = new Context()
    let handler: Handler | undefined
    ctx.provide('commands', captureCommands((definition) => { handler = definition as Handler }))
    ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
    let release: (() => void) | undefined
    const plan = { text: 'x', output: [], stopReason: 'completed' as const, structured: { verdict: 'no_issues', plan: [], notes: [] } }
    ctx.provide('subagents', {
      async start() { return { result: new Promise(resolve => { release = () => { resolve(plan) } }) } },
    })
    await ctx.plugin(Commands, { root: root, maintainCooldownMs: 0 })
    const started = await handler!.handler({ rawInput: 'maintain' })
    const id = /Maintenance run (\S+) started/.exec(started.text)?.[1] as string
    expect(id).toBeTruthy()
    // In flight: both the list form and the by-id form say so.
    const live = await handler!.handler({ rawInput: 'maintain status' })
    expect(live.text).toContain(id)
    expect(live.text).toContain('running')
    // The spawn happens inside the detached run: wait for it before releasing it.
    for (let attempt = 0; attempt < 500 && release === undefined; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
    release!()
    await settleMaintain(handler!, started)
    const settled = await handler!.handler({ rawInput: `maintain status ${id}` })
    expect(settled.text).toContain('succeeded')
    const report = await handler!.handler({ rawInput: `maintain report ${id}` })
    expect(report.kind).toBe('success')
    expect(report.text).toContain('verdict=no_issues')
    // An id nobody knows is NAMED, not silently empty.
    const unknown = await handler!.handler({ rawInput: 'maintain status nope' })
    expect(unknown.kind).toBe('error')
    expect(unknown.text).toContain('No run nope')
  })

  it('0.19.0 (S2): cancel stops a running scan, settles it as cancelled, and refuses a second cancel', async () => {
    const dir = await tempHome('evo-commands-runcancel-')
    const root = join(dir, 'skills')
    await mkdir(join(root, 'demo-skill'), { recursive: true })
    await writeFile(join(root, 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# Demo\n\nbody\n', 'utf8')
    const ctx = new Context()
    let handler: Handler | undefined
    ctx.provide('commands', captureCommands((definition) => { handler = definition as Handler }))
    ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
    let capturedSignal: AbortSignal | undefined
    let release: (() => void) | undefined
    const plan = { text: 'x', output: [], stopReason: 'aborted' as const, structured: { verdict: 'no_issues', plan: [], notes: [] } }
    ctx.provide('subagents', {
      async start(_kind: string, options: unknown) {
        capturedSignal = (options as { signal?: AbortSignal }).signal
        return { result: new Promise(resolve => { release = () => { resolve(plan) } }) }
      },
    })
    await ctx.plugin(Commands, { root: root, maintainCooldownMs: 0 })
    const started = await handler!.handler({ rawInput: 'maintain' })
    const id = /Maintenance run (\S+) started/.exec(started.text)?.[1] as string
    for (let attempt = 0; attempt < 500 && capturedSignal === undefined; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
    const cancelled = await handler!.handler({ rawInput: `maintain cancel ${id}` })
    expect(cancelled.kind).toBe('success')
    expect(capturedSignal?.aborted, 'cancel aborts the run, not the request').toBe(true)
    const status = await handler!.handler({ rawInput: `maintain status ${id}` })
    expect(status.text).toContain('cancelled')
    // One terminal state: cancelling again reports that, instead of a success.
    const again = await handler!.handler({ rawInput: `maintain cancel ${id}` })
    expect(again.kind).toBe('error')
    expect(again.text).toContain('already cancelled')
    release?.()
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

  it('preset install commits atomically: a failing staged write leaves the previous profile patch usable (S6.3 E-40)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'evo-commands-preset-atomic-'))
    const skillsRoot = await mkdtemp(join(tmpdir(), 'evo-commands-preset-atomic-skills-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const profileDir = join(home, 'profiles', 'web')
      const patchPath = profilePatchPath(profileDir)
      // Seed an existing installation so we can prove it survives an update.
      const oldPatch = "- insert:\n    - id: some-other-row\n      name: '@some/other-plugin'\n"
      await mkdir(profileDir, { recursive: true })
      await writeFile(patchPath, oldPatch, 'utf8')
      await seedPlatformBase(profileDir, 'standard', '- id: agent-loop\n  name: "@deepseek-ai/dsh-agent-loop"\n')
      // The staged write collides with a directory, so it throws EISDIR — a
      // deterministic "the write cannot complete" on Windows and POSIX. The ONE
      // file this install writes is the profile patch itself now.
      await mkdir(`${patchPath}.tmp`)
      const ctx = new Context()
      let handler: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
      ctx.provide('commands', captureCommands((definition) => { handler = definition as typeof handler }))
      ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
      ctx.provide('profileContext', profileContext('web', profileDir))
      await ctx.plugin(Commands, { root: skillsRoot })
      const result = await handler!.handler({ rawInput: 'preset install' })
      expect(result.kind).toBe('error')
      expect(result.text).toContain('Preset install failed')
      // The previous patch is untouched — no half-updated artifact — and the commit
      // phase never started, so no backup was taken either.
      expect(readFileSync(patchPath, 'utf8')).toBe(oldPatch)
      expect(existsSync(`${patchPath}.bak`)).toBe(false)
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      await rm(skillsRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('help documents the mutations and maintain --facts subcommands (S6.6-1 E-64)', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }>; input?: { hint?: string } } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    await ctx.plugin(Commands)
    // Both the input-declaration hint and the bare /evolution help list the
    // previously-hidden subcommands.
    expect(captured!.input?.hint).toContain('mutations')
    expect(captured!.input?.hint).toContain('--facts')
    const help = await captured!.handler({ rawInput: '' })
    expect(help.kind).toBe('success')
    expect(help.text).toContain('mutations')
    expect(help.text).toContain('maintain [--timeout=<ms> | --facts]')
  })

  it('T4-03: an unknown subcommand (or a known one missing its argument) answers ERROR, not a successful help dump', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    await ctx.plugin(Commands)
    // The bare command still documents itself, and so does an explicit `help`.
    for (const rawInput of ['', 'help']) {
      const bare = await captured!.handler({ rawInput })
      expect(bare.kind, rawInput).toBe('success')
      expect(bare.text, rawInput).toContain('subcommands (')
    }
    // A known subcommand without its argument, a bare unknown word, and a flag-only form: all
    // three used to return the help text with kind 'success', so a command that did nothing read
    // as done. (The control is `/evolution maintain --bogus`, which always refused.)
    for (const rawInput of ['approve', 'skill', 'params --group', 'nonsense --x']) {
      const result = await captured!.handler({ rawInput })
      expect(result.kind, rawInput).toBe('error')
      expect(result.text, rawInput).toContain('is not a subcommand this build answers')
    }
  })

  // V10-09 (F-05): the recommendation count is STRUCTURED — it travels as
  // MaintainOutcome.recommendationCount (validated plan length) into the
  // maintain event. The old text-parsing contract (`/^- \[/gm` + Notes:
  // splitting, repaired twice by F-365/V4-26/V6-38) is deleted without a dual
  // track; this case discriminates: an embedded "- [fake]" line inside a
  // finding would have inflated the old text count to 2.
  it('maintain event carries the structured recommendation count, not a text parse (V10-09/F-05)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'evo-cmd-rec-count-home-'))
    const dir = await mkdtemp(join(tmpdir(), 'evo-commands-reccount-'))
    const root = join(dir, 'skills')
    const skillDir = join(root, 'demo-skill')
    await mkdir(skillDir, { recursive: true })
    // Same dup-heading shape the maintenance suite proves fires dup_heading=over.
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# x\n\n## A\n\n## A\n\n' + 'y'.repeat(2_500) + '\n', 'utf8')
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const ctx = new Context()
      let handler: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
      ctx.provide('commands', captureCommands((definition) => { handler = definition as typeof handler }))
      ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
      ctx.provide('subagents', {
        async start(_kind: string, _options: unknown) {
          return {
            result: Promise.resolve({
              text: 'x',
              structured: {
                verdict: 'issues',
                plan: [{
                  kind: 'skill-level',
                  names: ['demo-skill'],
                  rule: 'B3',
                  // E1 (0.3.58): §3 completeness — the demo-skill body fires
                  // three over signals (dup_heading/overlong_line/narrow_name);
                  // a compliant structured plan covers them all in evidence.
                  evidence: [
                    { signal: 'dup_heading', value: 'A(2)' },
                    { signal: 'overlong_line', value: '7:2500' },
                    { signal: 'narrow_name', value: 'session-verb' },
                  ],
                  // An embedded "- [" line: the deleted text parser would have
                  // counted it as a second recommendation.
                  finding: 'Duplicate heading.\n- [fake] embedded line is not a recommendation',
                  recommendation: 'patch: remove the duplicate heading',
                  semantic_reasoning: 'duplicate heading shape',
                  impact: 'better',
                  impact_reason: 'remove duplicate',
                  reversibility: 'patch',
                  undo_path: 'backup restore',
                  confidence: 0.8,
                  needs_human: false,
                  is_override: false,
                }],
                notes: ['a plain note'],
              },
            }),
          }
        },
      })
      await ctx.plugin(Commands, { root: root, maintainCooldownMs: 0 })
      const result = await handler!.handler({ rawInput: 'maintain' })
      expect(result.kind).toBe('success')
      // The append is fire-and-forget; poll for the locked RMW to land.
      const eventPath = join(home, 'evolution', 'events.json')
      const deadline = Date.now() + 5000
      let raw: string | null = null
      while (raw === null && Date.now() < deadline) {
        raw = await nodeEvolutionIo().readText(eventPath)
        if (raw === null) await new Promise(resolve => setTimeout(resolve, 50))
      }
      expect(raw).not.toBeNull()
      const parsed = JSON.parse(raw ?? '{}') as { events: Array<{ type?: string; recommendations?: number; verdict?: string }> }
      const maintainEvents = parsed.events.filter(event => event.type === 'maintain')
      expect(maintainEvents).toHaveLength(1)
      expect(maintainEvents[0]?.recommendations).toBe(1)
      expect(maintainEvents[0]?.verdict).toBe('issues')
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  // F-13: a top-level function/symbol staged payload makes
  // JSON.stringify RESOLVE to undefined — the explicit type branch (not a
  // `.length` TypeError) must render the unserializable stub.
  it('pending --detail renders a resolving-undefined staged payload via the explicit branch (F-13/F-13)', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: string; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    ctx.provide('evolutionApproval', {
      list: async (status?: string) => status === 'pending'
        ? [{ id: 'c3', kind: 'skill', status: 'pending', summary: 'fn args', args: () => 'unserializable', createdAt: '', origin: 'background_review' }]
        : [],
    })
    await ctx.plugin(Commands)
    const detail = await captured!.handler({ rawInput: 'pending --detail' })
    expect(detail.text).toContain('c3  skill  pending  fn args')
    expect(detail.text).toContain('staged args: (unserializable)')
  })

  it('S2-P2-22: /evolution release routes to the approval service (happy path, and E-304 on an older service)', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: string; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    const released: string[] = []
    ctx.provide('evolutionApproval', {
      list: async () => [],
      release: async (id: string) => {
        released.push(id)
        return { ok: true, message: `Released "${id}" back to the pending window.` }
      },
    } as never)
    await ctx.plugin(Commands)
    const okResult = await captured!.handler({ rawInput: 'release x1' })
    expect(okResult.kind).toBe('success')
    expect(okResult.text).toContain('back to the pending window')
    expect(released).toEqual(['x1'])
    // A service without the release capability (older build) gets a distinct,
    // actionable error instead of a TypeError.
    const older = new Context()
    let olderCaptured: { handler(invocation: { rawInput?: string }): Promise<{ kind: string; text: string }> } | undefined
    older.provide('commands', captureCommands((definition) => { olderCaptured = definition as typeof olderCaptured }))
    older.provide('evolutionApproval', { list: async () => [], approve: async () => ({ ok: false, message: 'x' }), reject: async () => ({ ok: false, message: 'x' }) } as never)
    await older.plugin(Commands)
    const legacy = await olderCaptured!.handler({ rawInput: 'release x1' })
    expect(legacy.kind).toBe('error')
    expect(legacy.text).toContain('E-304')
  })

  it('v43 (P1-2): a staging deployment is refused for the destructive writes the skill runner cannot replay', async () => {
    const cases = [
      { input: 'consolidate target src', what: 'consolidate' },
      { input: 'restore', what: 'restore' },
      { input: 'skill restore demo', what: 'skill restore' },
      { input: 'skill undo demo', what: 'skill undo' },
    ]
    for (const { input, what } of cases) {
      const ctx = new Context()
      let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: string; text: string }> } | undefined
      ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
      // The deployment asked for foreground staging (the shipped default once
      // the row is enabled). The skill runner has no consolidate/restore
      // vocabulary, so these three used to write straight through the gate.
      ctx.provide('evolutionApproval', { isEnabled: true, stageForeground: true, list: async () => [] })
      await ctx.plugin(Commands)
      const result = await captured!.handler({ rawInput: input })
      expect(result.kind, input).toBe('error')
      expect(result.text, input).toContain('E-306')
      expect(result.text, input).toContain(what)
    }
  })

  it('v43 (P1-2): the same commands are not refused when the deployment does not stage foreground writes', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: string; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    ctx.provide('evolutionApproval', { isEnabled: true, stageForeground: false, list: async () => [] })
    await ctx.plugin(Commands)
    const result = await captured!.handler({ rawInput: 'consolidate target src' })
    // No curator is mounted here, so the command must reach its own E-302
    // service check — proof the refusal is policy-scoped, not a blanket ban.
    expect(result.kind).toBe('error')
    expect(result.text).toContain('E-302')
    expect(result.text).not.toContain('E-306')
  })

  it('S5.5 (audit P2-23): a staging deployment refuses a session-less restructure with the E-306 shape instead of staging unattributed', async () => {
    // The E-305 invocation shape (no agent → no session) used to slip past
    // `willStage` into an unconditional approval.request WITHOUT a session,
    // landing a staged record with no session attribution while
    // consolidate/restore answered E-306 for the same shape.
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: string; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    ctx.provide('evolutionIo', { provider: () => nodeEvolutionIo() })
    let requested = 0
    ctx.provide('evolutionApproval', {
      isEnabled: true,
      stageForeground: true,
      hasRunner: () => true,
      list: async () => [],
      request: async () => {
        requested += 1
        return { action: 'staged', message: 'staged restructure' }
      },
    } as never)
    await ctx.plugin(Commands)
    const result = await captured!.handler({ rawInput: 'restructure demo "## Heading" references/heading.md' })
    expect(result.kind).toBe('error')
    expect(result.text).toContain('E-306')
    expect(result.text).toContain('restructure')
    // The refusal replaces the staging call entirely — nothing is staged.
    expect(requested).toBe(0)
  })

  it('V24-12: a double-space subcommand variant dispatches instead of returning help as success', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: string; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    ctx.provide('evolutionApproval', {
      list: async (status?: string) => status === 'pending'
        ? [{ id: 'c4', kind: 'skill', status: 'pending', summary: 'whitespace probe', args: {}, createdAt: '', origin: 'foreground' }]
        : [],
    })
    await ctx.plugin(Commands)
    // `pending  --detail` (double space) used to miss every branch, fall into
    // the help fallback, and return kind:'success' with the full help text —
    // indistinguishable from a real result while NOTHING was listed.
    const result = await captured!.handler({ rawInput: 'pending  --detail' })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('c4  skill  pending  whitespace probe')
    expect(result.text).not.toContain('Evolution: memory, skills')
  })

  // V10-03 (P2-18): threatExemptLabels rides the Config into the write-side
  // SkillLibrary (core-side constructor option `threatExemptLabels` — P2-18
  // core batch). Default-empty semantics: a non-empty list is accepted and the
  // restructure write path behaves exactly as before on threat-free content.
  it('restructure accepts the threatExemptLabels config and keeps write behavior (P2-18)', async () => {
    const dir = await tempRoot('evo-commands-exempt-')
    const root = join(dir, 'skills')
    const skillDir = join(root, 'demo-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill for restructure tests.\n---\n\n# Demo\n\n## Log\n\nold detail\n\n## Keep\n\nnew\n', 'utf8')
    const ctx = new Context()
    let handler: { handler(invocation: { rawInput?: string; agent?: unknown }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { handler = definition as typeof handler }))
    const io = nodeEvolutionIo()
    ctx.provide('evolutionIo', { provider: () => io })
    await ctx.plugin(Commands, { root: root, threatExemptLabels: ['ssh_backdoor'] })
    const result = await handler!.handler({ rawInput: 'restructure demo-skill "Log" references/log.md' })
    expect(result.kind).toBe('success')
    const support = await io.readText(join(root, 'demo-skill', 'references', 'log.md'))
    expect(support).toContain('old detail')
  })


  it('pending --detail renders each record with its staged args, truncated and collapsed by default (F-328)', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: 'success' | 'error'; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
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
    // 0.13.0: the row carries its attribution (age, origin) between the summary and the args, so the
    // assertion is anchored on the summary and the staged-args line rather than on a fixed newline.
    expect(detail.text).toMatch(/a1 {2}skill {2}pending {2}create demo {2}· {2}[^\n]+\n {2}staged args: /)
    expect(detail.text).toContain(`  staged args: ${argsJson.slice(0, 500)}…(truncated ${argsJson.length - 500} chars)`)
    // The truncation is explicitly marked — an oversized payload never reads as
    // a complete-but-cut JSON, even when the cut lands mid-escape (V4-19).
    expect(detail.text).toMatch(/\(truncated \d+ chars\)/)
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

  it('V6-41: a damaged mutations/report shape renders unreadable instead of a TypeError (0.3.36)', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: string; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    ctx.provide('evolutionCurator', {
      skills: {
        listMutations: async () => [
          { at: '2026-01-01T00:00:00.000Z', skillName: 'good-skill', action: 'update', summary: 'ok' },
          { at: 12345, skillName: 'bad-skill' },
          null,
        ],
      },
      latestReport: async () => ({ runId: 'r1', startedAt: 12345, archived: 'nope', failed: [{ name: 'a' }] }),
    })
    await ctx.plugin(Commands)
    const mutations = await captured!.handler({ rawInput: 'mutations' })
    expect(mutations.kind).toBe('success')
    expect(mutations.text).toContain('good-skill')
    expect(mutations.text).not.toContain('bad-skill')
    const report = await captured!.handler({ rawInput: 'curator report' })
    expect(report.kind).toBe('error')
    expect(report.text).toContain('Report file unreadable.')
  })

  it('P2-16 (v38): /evolution curator report surfaces an interrupted run instead of failed=(none)', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: string; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    ctx.provide('evolutionCurator', {
      latestReport: async () => ({
        runId: 'r-aborted',
        startedAt: '2026-09-11T00:00:00.000Z',
        archived: [{ name: 'landed-skill', reason: 'Lifecycle: reached archive threshold' }],
        failed: [],
        aborted: 'evolution-curator was disposed mid-run - consolidation skipped; archives that landed above are still accounted',
        unattributed: ['some run-level error with no skill name'],
      }),
    })
    await ctx.plugin(Commands)
    const result = await captured!.handler({ rawInput: 'curator report' })
    expect(result.kind).toBe('success')
    // The skill-attributable list is empty, so the run-level facts are the only
    // signal that this pass did not complete (V27 CUR-2 false-clean, command side).
    expect(result.text).toContain('failed=(none)')
    expect(result.text).toContain('aborted=evolution-curator was disposed mid-run')
    expect(result.text).toContain('unattributed=1')
    // A clean report keeps the previous shape: no run-level lines at all.
    let clean: typeof captured
    const cleanCtx = new Context()
    cleanCtx.provide('commands', captureCommands((definition) => { clean = definition as typeof captured }))
    cleanCtx.provide('evolutionCurator', {
      latestReport: async () => ({ runId: 'r-clean', startedAt: '2026-09-11T01:00:00.000Z', archived: [], failed: [] }),
    })
    await cleanCtx.plugin(Commands)
    const cleanResult = await clean!.handler({ rawInput: 'curator report' })
    expect(cleanResult.text).not.toContain('aborted=')
    expect(cleanResult.text).not.toContain('unattributed=')
  })

  it('V6-29: maintain --timeout above the AbortSignal domain is rejected at the command gate (0.3.36)', async () => {
    const ctx = new Context()
    let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: string; text: string }> } | undefined
    ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
    await ctx.plugin(Commands)
    // 5e9 > 2^32-1: AbortSignal.timeout would throw a synchronous RangeError.
    const result = await captured!.handler({ rawInput: 'maintain --timeout 5000000000' })
    expect(result.kind).toBe('error')
    expect(result.text).toContain('Invalid --timeout value')
    // P2-10 (v19): 2^31..2^32-1 does NOT throw — Node warns and silently sets
    // 1ms, so the command must reject it like the RangeError case.
    const overflow = await captured!.handler({ rawInput: 'maintain --timeout 2147483648' })
    expect(overflow.kind).toBe('error')
    expect(overflow.text).toContain('Invalid --timeout value')
  })

  it('T4-12/A54: a trigger arriving mid-attempt is QUEUED — one failed attempt no longer ends the automatic migration', async () => {
    const dir = await tempRoot('evo-cmd-migration-race-')
    const home = join(dir, 'profile')
    await mkdir(home, { recursive: true })
    // The document the migration exists to move (the name the platform import leaves behind).
    const legacy = join(home, 'settings.yaml.imported')
    await writeFile(legacy, 'evolution-memory:\n  memoryCharLimit: 2200\n', 'utf8')
    const ctx = new Context()
    ctx.provide('commands', captureCommands(() => {}))
    const writes: Array<{ rowId: string; patch: Record<string, unknown> }> = []
    ctx.provide('settings', {
      describe: () => [{ ns: 'memory-files', user: {} }],
      update: async (rowId: string, patch: Record<string, unknown>) => { writes.push({ rowId, patch }) },
    })
    ctx.provide('profileContext', { home })
    // The FIRST read of the legacy document hangs and then fails (a slow or unreadable document is
    // enough) — that is the attempt the guard used to make final. Later reads are the real ones.
    const io = nodeEvolutionIo()
    let attempts = 0
    let released = false
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    ctx.provide('evolutionIo', {
      provider: () => ({
        ...io,
        readText: async (path: string) => {
          if (path !== legacy) return io.readText(path)
          attempts += 1
          if (released) return io.readText(path)
          await held
          throw new Error('EIO: the legacy document is unreadable right now')
        },
      }),
    })
    await ctx.plugin(Commands, { root: dir })
    // Wait for the first attempt to reach its hanging read, then let the loader settle: both
    // triggers have now fired, with the second arriving while the first is in flight.
    await vi.waitFor(() => { expect(attempts).toBe(1) })
    await new Promise(resolve => setTimeout(resolve, 20))
    released = true
    release()
    // The queued trigger runs. Without the queue this times out: one warning, no second attempt,
    // and the legacy document is never migrated (the comment claimed a "next trigger" that does
    // not exist — both lifecycle moments have already passed).
    await vi.waitFor(() => { expect(writes).toEqual([{ rowId: 'memory-files', patch: { memoryChars: 2200 } }]) })
    expect(attempts).toBe(2)
    await ctx.fiber.dispose()
  })

  it('F-14/E-7 (v18) → V27 G2.4: both root keys stay declared, and the expired alias fails the load', () => {
    const value = (Commands.Config as unknown as {
      ['~standard']: { validate(input: unknown): { value: { maintainTimeoutMs: number; root: string; skillsRoot: string } } }
    })['~standard'].validate({}).value
    expect(value.maintainTimeoutMs).toBe(600_000)
    // `root` is canonical. `skillsRoot` stays DECLARED (so the loader hands the
    // key to the plugin instead of dropping it) but carries no root semantics:
    // its one-minor-version window closed at 0.3.65, and a deployment that still
    // sets it now fails the load loudly rather than pointing at a root nobody
    // reads (M-08 — the promise was two releases past expiry).
    expect(value.root).toBe('')
    expect(value.skillsRoot).toBe('')
    const ctx = new Context()
    expect(() => { Commands.apply(ctx, { skillsRoot: '/tmp/legacy-root' }) })
      .toThrow(/skillsRoot" was removed after 0\.3\.65/)
  })

  it('review P1-1: a run another process is running blocks a second start and cannot be cancelled here', async () => {
    const dir = await tempHome('evo-commands-crossplane-')
    const root = join(dir, 'skills')
    await mkdir(join(root, 'demo-skill'), { recursive: true })
    await writeFile(join(root, 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill.\n---\n\n# Demo\n\nbody\n', 'utf8')
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
    // The refresh is what makes this work for a run that appears AFTER this plane mounted.
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

  it('review P2-2: a run whose report is gone answers "has NO result" (the missing branch, on a real io)', async () => {
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
    await rm(join(dir, 'evolution', 'reports', `maintain-${runId}.json`), { force: true })
    await rm(join(dir, 'evolution', 'reports', `maintain-${runId}.md`), { force: true })
    const report = await handler!.handler({ rawInput: `maintain report ${runId}` })
    expect(report.kind).toBe('error')
    expect(report.text).toContain('has NO result')
    expect(report.text, 'the unreadable branch must not answer this').not.toContain('could not be read')
  })
})

it('v28 G7.2 (CMD-01): a faulting mounted service yields kind:error on every state-touching subcommand, never a throw', async () => {
  const ctx = new Context()
  let captured: { handler(invocation: { rawInput?: string }): Promise<{ kind: string; text: string }> } | undefined
  ctx.provide('commands', captureCommands((definition) => { captured = definition as typeof captured }))
  // Any property access on these services throws — the corrupted-state /
  // transient-IO shape (quarantine, lock budget, EIO) that the wrapper exists
  // for. The guard iterates the REGISTRY's state-touching subcommands, so a
  // future subcommand that reads a service without the wrapper fails here.
  const faulting = () => new Proxy({}, {
    get(target, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return (target as Record<symbol, unknown>)[prop as symbol]
      throw new Error(`service fault injected at "${prop}" (quarantine-class)`)
    },
  })
  ctx.provide('evolutionApproval', faulting())
  ctx.provide('evolutionCurator', faulting())
  ctx.provide('evolutionReplay', faulting())
  await ctx.plugin(Commands)
  expect(captured).toBeDefined()
  // Every subcommand that reads a mounted service (drawn from COMMAND_ENTRIES;
  // the state-touching set). Also pins the G0.3 contract for the previously
  // bare branches: pending/approve/reject/curator/mutations/restore/replay.
  const stateTouching = [
    'pending', 'pending --detail',
    'approve some-id', 'reject some-id', 'release some-id',
    'curator run', 'curator pause', 'curator resume', 'curator status', 'curator report', 'curator scope',
    'mutations', 'skills health',
    'restore', 'replay',
  ]
  for (const rawInput of stateTouching) {
    const result = await captured!.handler({ rawInput })
    expect({ rawInput, kind: result.kind }).toEqual({ rawInput, kind: 'error' })
    expect(result.text).toContain('command failed')
  }
  // `maintain` keeps its own structured error path (pre-v28). Unmatched input answers the
  // T4-03 error WITHOUT touching a service — so it carries neither the fault message nor a
  // 'success' (the help fallback used to claim one). The bare command is the success control.
  const unmatched = await captured!.handler({ rawInput: 'definitely-not-a-subcommand' })
  expect(unmatched.kind).toBe('error')
  expect(unmatched.text).toContain('is not a subcommand this build answers')
  expect(unmatched.text).not.toContain('service fault injected')
  const help = await captured!.handler({ rawInput: '' })
  expect(help.kind).toBe('success')
})
