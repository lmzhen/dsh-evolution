/**
 * The variant-form opt-in gate: which sessions the family's cross-session
 * consumers act on (0.3.77 / C axis).
 *
 * The probe is proved against a structural stand-in for the two platform
 * services it reads (`agents`, `tools`), because the QUESTION it answers is
 * "what does this session's scope see" — the platform's own semantics
 * (`tools.get(name, scope)`), not a family-local list of preset ids.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import { FAMILY_SESSION_TOOL_NAMES, sessionAudited, sessionSeesFamilyTools } from '../src/opt-in.ts'

/** A context carrying the two services the probe reads, in the platform's shape. */
function probeContext(options: {
  tools?: { get(name: string, scope?: object): unknown }
  agents?: { get(id: string): { ctx?: Context } | undefined }
}): Context {
  const ctx = new Context()
  if (options.tools !== undefined) ctx.provide('tools', options.tools)
  if (options.agents !== undefined) ctx.provide('agents', options.agents)
  return ctx
}

describe('sessionSeesFamilyTools', () => {
  it('answers false when the deployment mounts no tools registry', () => {
    expect(sessionSeesFamilyTools(probeContext({}), 's1')).toBe(false)
  })

  it('answers true for the GLOBAL view — the attach form registers the model rows at profile root', () => {
    const seen: Array<string | undefined> = []
    const ctx = probeContext({
      tools: { get: (name, scope) => { seen.push(name); return scope === undefined && name === 'skill_manage' ? { name } : undefined } },
      agents: { get: () => undefined },
    })
    expect(sessionSeesFamilyTools(ctx, 's1')).toBe(true)
    // No live agent means no scope to ask in: the global layer is the question.
    expect(seen).toEqual(['skill_manage'])
  })

  it('asks in the session\'s own scope — the variant form registers them inside the preset', () => {
    const hostCtx = new Context()
    // The platform's own minting: `createScope` returns the SCOPED context,
    // which is what `scopeOf` reads back — the same relation an agent holds
    // after a preset mount binds it to the standing scope.
    const scope = {}
    const agentCtx = createScope(hostCtx, scope).ctx
    const scopes: Array<object | undefined> = []
    const ctx = probeContext({
      tools: {
        get: (name, asked) => {
          scopes.push(asked)
          return asked === scope && name === 'memory' ? { name } : undefined
        },
      },
      agents: { get: id => (id === 'joined' ? { ctx: agentCtx } : undefined) },
    })
    expect(sessionSeesFamilyTools(ctx, 'joined')).toBe(true)
    expect(scopes.every(asked => asked === scope)).toBe(true)
    // A session that joined nothing resolves the global layer and sees no
    // family tool registered there — the case that used to be reviewed anyway.
    expect(sessionSeesFamilyTools(ctx, 'other')).toBe(false)
  })

  it('probes family-owned tool names only', () => {
    const asked: string[] = []
    const ctx = probeContext({ tools: { get: (name) => { asked.push(name); return undefined } } })
    sessionSeesFamilyTools(ctx, 's1')
    expect(asked).toEqual([...FAMILY_SESSION_TOOL_NAMES])
    // The platform's own session-query tool is deliberately NOT a probe: a
    // session can carry it without ever mounting a family row.
    expect(asked).not.toContain('session_search')
  })
})

describe('sessionAudited', () => {
  it('is unconditional when a deployment declares no session scoping, and per-session when it does', () => {
    const ctx = probeContext({ tools: { get: () => undefined } })
    // sessionScoped false / absent: the historical behavior, every session.
    expect(sessionAudited(ctx, 's1', false)).toBe(true)
    expect(sessionAudited(ctx, 's1', undefined)).toBe(true)
    // sessionScoped true: only a session that carries the family's model rows.
    expect(sessionAudited(ctx, 's1', true)).toBe(false)
  })
})

describe('the scoped-probe witness (S0-4 / v43 J-1, G-1)', () => {
  /** A fresh module instance: the witness is PROCESS state, so one import can
   * emit its single warn only once — each case needs its own gate. */
  async function freshGate(): Promise<typeof import('../src/opt-in.ts')> {
    vi.resetModules()
    return await import('../src/opt-in.ts')
  }

  /** The gate's context plus the warns it received. `logger` is an own property
   * of a CHILD context, so the recorder IS the row's own warn channel — the one
   * the gate is handed in production (a bare context's logger sinks nowhere a
   * spec can read, which is why the recorder must be the logger itself). */
  function recordingContext(options: {
    tools?: { get(name: string, scope?: object): unknown }
    agents?: { get(id: string): { ctx?: Context } | undefined }
  }): { ctx: Context; warns: string[] } {
    const host = probeContext(options)
    const warns: string[] = []
    return { ctx: host.extend({ logger: { warn: (message: string) => { warns.push(message) } } }), warns }
  }

  it('is idle until the gate has been asked anything', async () => {
    const { scopedProbeReport } = await freshGate()
    expect(scopedProbeReport()).toEqual({ verdict: 'idle', hits: 0, misses: 0 })
  })

  it('leaves exactly ONE warn when the probe never matches, however many sessions miss', async () => {
    const { sessionAudited, scopedProbeReport } = await freshGate()
    // The host-only / disabled-row shape: the tools service is mounted, the
    // family's model tools are not registered anywhere the gate can see.
    const { ctx, warns } = recordingContext({ tools: { get: () => undefined }, agents: { get: () => undefined } })
    // Before S0-4 all four answers below were silent, so a deployment whose
    // cross-session consumers were inert for every session looked healthy.
    expect(sessionAudited(ctx, 's1', true)).toBe(false)
    expect(sessionAudited(ctx, 's2', true)).toBe(false)
    expect(sessionAudited(ctx, 's1', true)).toBe(false)
    // Unscoped rows never consult the probe — and must not join the tally.
    expect(sessionAudited(ctx, 's3', false)).toBe(true)
    expect(scopedProbeReport()).toEqual({ verdict: 'never-hit', hits: 0, misses: 3 })
    expect(warns).toHaveLength(1)
    // The warn names the check and the next step, not just the verdict.
    expect(warns[0]).toContain('tool-memory')
    expect(warns[0]).toContain('tool-skill-manage')
    expect(warns[0]).toContain('HOST-ONLY')
    expect(warns[0]).toContain('VARIANT')
    expect(warns[0]).toContain('/evolution doctor')
  })

  it('says nothing once any session carried the family tools', async () => {
    const { sessionAudited, scopedProbeReport } = await freshGate()
    // The variant shape: only the agent that joined the preset's standing scope
    // resolves the model rows — the relation the scoping test above pins. The key
    // is minted by the SAME module instance the gate reads it with: `createScope`
    // tags the context with a module-local symbol, so one minted before
    // `vi.resetModules()` is invisible to the fresh `scopeOf` the gate calls.
    const { createScope } = await import('@deepseek-ai/dsh-scope')
    const scope = {}
    const joined = createScope(new Context(), scope).ctx
    const { ctx, warns } = recordingContext({
      tools: { get: (name, asked) => asked === scope && name === 'memory' ? { name } : undefined },
      agents: { get: id => id === 'family' ? { ctx: joined } : undefined },
    })
    expect(sessionAudited(ctx, 'family', true)).toBe(true)
    // A later non-family session is the intended per-session skip, not a fault:
    // the witness has seen a hit, so the one-time warn never fires.
    expect(sessionAudited(ctx, 'other', true)).toBe(false)
    expect(scopedProbeReport()).toEqual({ verdict: 'hit', hits: 1, misses: 1 })
    expect(warns).toEqual([])
  })
})
