/**
 * The skill-history host routes: the trust fence as a pure decision, then one end-to-end pass over a
 * real HTTP socket so the fence, the method gate, the bounded body reader and the curator seam are
 * exercised together (the platform requires a real-composition test for a product-visible plugin).
 */
import { describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionCurator from '@deepseek-ai/dsh-evolution-curator'
import { DEFAULT_SKILL_LIMITS, SkillLibrary, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { MAX_REQUEST_BODY_BYTES, SKILL_HISTORY_ROUTES, isLoopbackRequest, makeSkillHistoryRoutes, type FenceRequest } from '../src/routes.ts'
import { tempHome } from '../../test-support/temp-home.ts'

/** A request the fence judges: only the fields the fence reads, with a loopback default. */
function fenceRequest(overrides: Partial<FenceRequest> = {}): FenceRequest {
  return { headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' }, ...overrides }
}

describe('skill-history routes: the loopback fence', () => {
  it('admits a loopback socket with a loopback Host and no browser markers', () => {
    expect(isLoopbackRequest(fenceRequest())).toBe(true)
    expect(isLoopbackRequest(fenceRequest({ headers: { host: 'localhost:3080' } }))).toBe(true)
    expect(isLoopbackRequest(fenceRequest({ headers: { host: '[::1]:3080' } }))).toBe(true)
    expect(isLoopbackRequest(fenceRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' } }))).toBe(true)
  })

  it('refuses a non-loopback socket, a rebound Host, a cross-site marker and a foreign Origin', () => {
    expect(isLoopbackRequest(fenceRequest({ socket: { remoteAddress: '192.168.1.7' } }))).toBe(false)
    expect(isLoopbackRequest(fenceRequest({ socket: undefined }))).toBe(false)
    expect(isLoopbackRequest(fenceRequest({ headers: { host: 'evil.example' } }))).toBe(false)
    expect(isLoopbackRequest(fenceRequest({ headers: { host: '' } }))).toBe(false)
    expect(isLoopbackRequest(fenceRequest({ headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' } }))).toBe(false)
    expect(isLoopbackRequest(fenceRequest({ headers: { host: '127.0.0.1:3080', origin: 'http://evil.example' } }))).toBe(false)
    // X-Forwarded-For is never consulted: the socket address decides.
    expect(isLoopbackRequest(fenceRequest({ headers: { host: '127.0.0.1:3080', 'x-forwarded-for': '10.0.0.9' } }))).toBe(true)
  })
})

/** A minimal request fixture for the fabricated (non-socket) path. */
function fakeRequest(method: string, url: string): IncomingMessage {
  return { method, url, headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage
}

/** A minimal response fixture capturing what a handler wrote. */
function fakeResponse(): { status: number; body: unknown; writeHead(status: number): void; end(body?: string): void } {
  const captured = {
    status: 0,
    body: undefined as unknown,
    writeHead(status: number): void { captured.status = status },
    end(body?: string): void { captured.body = body === undefined ? undefined : JSON.parse(body) },
  }
  return captured
}

/** One host over the real routes: a bare http server dispatching by exact path. */
async function startHost(routes: ReturnType<typeof makeSkillHistoryRoutes>): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0]
    const route = routes.find(candidate => candidate.kind === 'exact' && candidate.path === path)
    if (route === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    void route.handler(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    origin: 'http://127.0.0.1:' + String(port),
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    },
  }
}

describe('skill-history routes: over a real socket', () => {
  it('answers the family\'s E-302 sentence when the curator is not mounted', async () => {
    const routes = makeSkillHistoryRoutes({ getCurator: () => undefined })
    const skillsRoute = routes.find(route => route.path === SKILL_HISTORY_ROUTES.skills)
    expect(skillsRoute).toBeDefined()
    const res = fakeResponse()
    await skillsRoute?.handler(fakeRequest('GET', SKILL_HISTORY_ROUTES.skills), res as unknown as ServerResponse)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: false, code: 'curator-not-mounted' })
  })

  it('serves the health probe, the skills with history, the split version lists and one undo', async () => {
    await tempHome('dsh-skill-history-routes-')
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    await ctx.plugin(EvolutionCurator, { autoStart: false })
    const root = join(process.env.DSH_HOME ?? '', 'skills')
    const library = new SkillLibrary(root, nodeEvolutionIo(), { ...DEFAULT_SKILL_LIMITS, versionKeep: 20 })
    const body = (text: string): string => '---\nname: panel-skill\ndescription: routes fixture\n---\n' + text + '\n'
    await library.create('panel-skill', body('One.'))
    await library.update('panel-skill', body('Two.'))
    await library.writeSupportFile('panel-skill', 'references/notes.md', '# notes\n')
    const host = await startHost(makeSkillHistoryRoutes({ getCurator: () => ctx.evolutionCurator }))
    try {
      // Health: the probe the client uses before it claims a route family exists.
      const health = await fetch(host.origin + SKILL_HISTORY_ROUTES.health)
      expect(health.status).toBe(200)
      expect(await health.json()).toEqual({ ok: true, data: { surface: 'skill-history' } })
      // Skills: only the tree entries that actually recorded a version.
      const skills = await fetch(host.origin + SKILL_HISTORY_ROUTES.skills)
      expect(skills.status).toBe(200)
      const skillBody = await skills.json() as {
        ok: boolean
        data: Array<{
          name: string
          versions: number
          description: string
          managed: boolean
          protectedBy: string | null
          protectionUnknown: boolean
        }>
      }
      // The row carries what the listing already knew, so the left column can say what a skill IS.
      expect(skillBody.data).toHaveLength(1)
      expect(skillBody.data[0]?.name).toBe('panel-skill')
      expect(skillBody.data[0]?.versions).toBe(3)
      expect(skillBody.data[0]?.description).toContain('fixture')
      expect(typeof skillBody.data[0]?.managed).toBe('boolean')
      expect(skillBody.data[0]?.protectionUnknown).toBe(false)
      // Versions: the body chain and the support-file chain come back apart, and every row carries
      // the verdicts and the vocabulary key the panel renders (it owns no rule of its own).
      const versions = await fetch(host.origin + SKILL_HISTORY_ROUTES.versions + '?name=panel-skill')
      expect(versions.status).toBe(200)
      const versionBody = await versions.json() as {
        ok: boolean
        data: {
          content: Array<{ action: string; actionKind: string; age: { unit: string; n: number }; undoable: boolean; charsDelta?: number }>
          support: Array<{ action: string; actionKind: string }>
          liveHash: string | null
        }
      }
      expect(versionBody.data.content.map(entry => entry.action)).toEqual(['create', 'update'])
      expect(versionBody.data.content.map(entry => entry.actionKind)).toEqual(['create', 'update'])
      expect(versionBody.data.support.map(entry => entry.action)).toEqual(['write_file'])
      expect(versionBody.data.support.map(entry => entry.actionKind)).toEqual(['support-write'])
      expect(typeof versionBody.data.content[0]?.age.unit).toBe('string')
      // The live content is the newest body version, so exactly that row is not undoable.
      expect(versionBody.data.content.filter(entry => ! entry.undoable)).toHaveLength(1)
      // The diff route: one version against its predecessor, as facts plus the changed region.
      const diff = await fetch(host.origin + SKILL_HISTORY_ROUTES.diff + '?name=panel-skill&v=2')
      expect(diff.status).toBe(200)
      const diffBody = await diff.json() as {
        ok: boolean
        data: {
          v: number
          against: number | null
          hunks: Array<{ path: string; oldText: string; newText: string }>
          truncated: boolean
        }
      }
      expect(diffBody.data.v).toBe(2)
      expect(diffBody.data.against).toBe(1)
      expect(diffBody.data.hunks[0]?.path).toBe('SKILL.md')
      expect(diffBody.data.hunks[0]?.oldText).not.toBe(diffBody.data.hunks[0]?.newText)
      // Refusals stay refusals: a version that is not in the history, and a malformed query.
      expect((await fetch(host.origin + SKILL_HISTORY_ROUTES.diff + '?name=panel-skill&v=99')).status).toBe(404)
      expect((await fetch(host.origin + SKILL_HISTORY_ROUTES.diff + '?name=panel-skill&v=x')).status).toBe(400)
      expect((await fetch(host.origin + SKILL_HISTORY_ROUTES.diff)).status).toBe(400)
      // A support version is refused with the curator's own sentence, not a frontmatter error.
      const refused = await fetch(host.origin + SKILL_HISTORY_ROUTES.undo, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'panel-skill', v: 3 }),
      })
      expect(refused.status).toBe(200)
      const refusedBody = await refused.json() as { ok: boolean; code: string; message: string }
      expect(refusedBody.ok).toBe(false)
      expect(refusedBody.code).toBe('undo-refused')
      expect(refusedBody.message).toContain("holds a SUPPORT FILE's bytes")
      // The undo itself: an empty body means "the state before the last body change".
      const undone = await fetch(host.origin + SKILL_HISTORY_ROUTES.undo, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'panel-skill' }),
      })
      expect(undone.status).toBe(200)
      const undoneBody = await undone.json() as { ok: boolean; data: { message: string } }
      expect(undoneBody.ok).toBe(true)
      expect(undoneBody.data.message).toContain('undone to v1')
      expect(await library.read('panel-skill')).toContain('One.')
      // Transport refusals stay transport refusals: method, missing name, bad body, unknown path.
      expect((await fetch(host.origin + SKILL_HISTORY_ROUTES.versions, { method: 'POST' })).status).toBe(405)
      expect((await fetch(host.origin + SKILL_HISTORY_ROUTES.versions)).status).toBe(400)
      const badBody = await fetch(host.origin + SKILL_HISTORY_ROUTES.undo, { method: 'POST', body: 'not json' })
      expect(badBody.status).toBe(400)
      const badVersion = await fetch(host.origin + SKILL_HISTORY_ROUTES.undo, {
        method: 'POST',
        body: JSON.stringify({ name: 'panel-skill', v: 0 }),
      })
      expect(badVersion.status).toBe(400)
      expect((await fetch(host.origin + '/api/dsh-evolution/skill-history/unknown')).status).toBe(404)
      // The body bound is a real limit, not a comment.
      const oversized = await fetch(host.origin + SKILL_HISTORY_ROUTES.undo, { method: 'POST', body: 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1) })
      expect(oversized.status).toBe(400)
    } finally {
      await host.close()
    }
  })
})
