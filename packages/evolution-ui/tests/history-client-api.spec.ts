// @tier fast
/**
 * The browser half's data face: the request each callback makes, and the refusal path that keeps the
 * curator's own sentence instead of inventing one. The rendered panel is covered by tsc, the bundle
 * build and a live pass (see the README's known limitations).
 */
import { describe, expect, it } from 'vitest'
import { HOST_ROUTES, SkillHistoryRefusal, createSkillHistoryApi } from '../src/panels/history/client/api.ts'

/** What a stub records and the fetch it stands in for. */
interface StubFetch {
  calls: Array<{ path: string; init: RequestInit | undefined }>
  fetch: typeof fetch
}

/** A fetch stub recording what it was asked for and replaying one canned response. */
function stubFetch(response: { ok: boolean; status?: number; body: unknown }): StubFetch {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = []
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    calls.push({ path: input, init })
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.body,
    } as unknown as Response
  }
  return { calls, fetch: fetchImpl as unknown as typeof fetch }
}

describe('skill-history client api', () => {
  it('reads the skill list and one skill\'s two chains from the mirrored routes', async () => {
    const skills = stubFetch({ ok: true, body: { ok: true, data: [{ name: 'a', versions: 2 }] } })
    const api = createSkillHistoryApi(skills.fetch)
    expect(await api.skills()).toEqual([{ name: 'a', versions: 2 }])
    expect(skills.calls[0]?.path).toBe(HOST_ROUTES.skills)
    const versions = stubFetch({ ok: true, body: { ok: true, data: { content: [], support: [] } } })
    const api2 = createSkillHistoryApi(versions.fetch)
    await api2.versions('my skill')
    expect(versions.calls[0]?.path).toBe(HOST_ROUTES.versions + '?name=my%20skill')
  })

  it('reads one version\'s whole body from its own route', async () => {
    const body = stubFetch({ ok: true, body: { ok: true, data: { v: 2, display: '# two', chars: 5, truncated: false } } })
    const api = createSkillHistoryApi(body.fetch)
    expect(await api.body('my skill', 2)).toEqual({ v: 2, display: '# two', chars: 5, truncated: false })
    expect(body.calls[0]?.path).toBe(HOST_ROUTES.body + '?name=my%20skill&v=2')
  })

  it('posts the undo with and without a version number', async () => {
    const stub = stubFetch({ ok: true, body: { ok: true, data: { message: '已撤销到 v1' } } })
    const api = createSkillHistoryApi(stub.fetch)
    expect(await api.undo('a')).toBe('已撤销到 v1')
    expect(stub.calls[0]?.path).toBe(HOST_ROUTES.undo)
    expect(stub.calls[0]?.init?.method).toBe('POST')
    expect(stub.calls[0]?.init?.body).toBe(JSON.stringify({ name: 'a' }))
    await api.undo('a', 3)
    expect(stub.calls[1]?.init?.body).toBe(JSON.stringify({ name: 'a', v: 3 }))
  })

  it('reads the stats snapshot and preserves measured zeroes versus missing facts', async () => {
    const stub = stubFetch({
      ok: true,
      body: {
        ok: true,
        data: {
          rows: [{
            name: 'a',
            description: 'alpha',
            versions: 0,
            lastAt: null,
            health: { verdict: 'warn', bodyChars: 0, bodyTokens: null, supportFiles: 0, findings: [] },
            usage: { useCount: 0, viewCount: null, viewCount30d: 0, patchCount: 1 },
            feedback: 0,
            feedback30d: 0,
            negativeFeedback30d: 0,
            feedbackRate30d: null,
          }, { description: 'no name' }],
          totals: { skills: 1, needsAttention: 1, bodyChars: 0, supportFiles: 0, successes: { offload: 0, condense: 0, extract: 1 } },
          counts: { offload: 0, condense: 0, extract: 1 },
          governance: [{ runId: 'run-1', state: 'succeeded', startedAt: 1, target: 'a', mode: 'offload', resultRef: null }],
          generatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    })
    const api = createSkillHistoryApi(stub.fetch)
    const stats = await api.stats()
    expect(stub.calls[0]?.path).toBe(HOST_ROUTES.stats)
    expect(stats.rows).toHaveLength(1)
    expect(stats.rows[0]).toMatchObject({ name: 'a', versions: 0, feedback: 0 })
    expect(stats.rows[0]?.health).toMatchObject({ bodyChars: 0, bodyTokens: null, supportFiles: 0 })
    expect(stats.rows[0]?.usage).toMatchObject({ useCount: 0, viewCount: null, viewCount30d: 0, patchCount: 1 })
    expect(stats.rows[0]).toMatchObject({ feedback30d: 0, negativeFeedback30d: 0, feedbackRate30d: null })
    expect(stats.totals).toMatchObject({ skills: 1, needsAttention: 1, bodyChars: 0 })
    expect(stats.counts).toEqual({ offload: 0, condense: 0, extract: 1 })
    expect(stats.governance).toEqual([{ runId: 'run-1', state: 'succeeded', startedAt: 1, target: 'a', mode: 'offload', resultRef: null }])
  })

  it('surfaces a business refusal verbatim and never as a silent empty result', async () => {
    const stub = stubFetch({ ok: true, body: { ok: false, code: 'undo-refused', message: 'Version v3 of "a" 存的是支撑文件的字节\'s bytes' } })
    const api = createSkillHistoryApi(stub.fetch)
    await expect(api.undo('a', 3)).rejects.toBeInstanceOf(SkillHistoryRefusal)
    await expect(api.undo('a', 3)).rejects.toThrow('存的是支撑文件的字节')
    const http = stubFetch({ ok: false, status: 403, body: {} })
    const api2 = createSkillHistoryApi(http.fetch)
    await expect(api2.skills()).rejects.toThrow('HTTP 403')
  })
})

