/**
 * The variant-form opt-in gate: which sessions the family's cross-session
 * consumers act on (0.3.77 / C axis).
 *
 * The probe is proved against a structural stand-in for the two platform
 * services it reads (`agents`, `tools`), because the QUESTION it answers is
 * "what does this session's scope see" — the platform's own semantics
 * (`tools.get(name, scope)`), not a family-local list of preset ids.
 */
import { describe, expect, it } from 'vitest'
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
