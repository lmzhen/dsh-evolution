/**
 * The approval route surface, driven through a REAL loopback http server (the fence reads the socket, so
 * a fabricated request cannot exercise it) plus one source tripwire for the browser half's copy of the
 * path literals.
 *
 * The decisions are business answers: a refusal keeps HTTP 200 and carries the service's own sentence,
 * which is what makes the card and the console command show the same words.
 */
import { createServer, request } from 'node:http'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import type { PendingRecord, PendingStatus } from '@deepseek-ai/dsh-evolution-state-storage'
import { isLoopbackRequest, type FenceRequest } from '@deepseek-ai/dsh-evolution-core'
import { APPROVAL_ROUTES, makeApprovalRoutes, type ApprovalFace } from '../src/routes.ts'

/** A pending record shaped the way the state medium hands one back. */
function record(overrides: Partial<PendingRecord> = {}): PendingRecord {
  return {
    id: 'p-1',
    kind: 'skill',
    summary: 'patch skill "alpha"',
    args: {},
    createdAt: '2026-09-30T00:00:00.000Z',
    status: 'pending',
    ...overrides,
  }
}

interface Face extends ApprovalFace {
  readonly calls: string[]
  /** Make the next approve/reject throw, to exercise the transport-failure answer. */
  failNext: boolean
  /** Answer a decision with a refusal (the service's business "no"). */
  refuseNext: boolean
}

function makeFace(): Face {
  const face: Face = {
    calls: [],
    failNext: false,
    refuseNext: false,
    list: async (status: PendingStatus = 'pending') => {
      face.calls.push('list:' + status)
      const all = [record(), record({ id: 'p-2', status: 'approved', summary: 'memory op' })]
      return all.filter(candidate => candidate.status === status)
    },
    approve: async (id: string) => {
      face.calls.push('approve:' + id)
      if (face.failNext) throw new Error('state medium is unreadable')
      return face.refuseNext ? { ok: false, message: 'pending record "x" is not in the pending window' } : { ok: true, message: 'approved ' + id }
    },
    reject: async (id: string) => {
      face.calls.push('reject:' + id)
      if (face.failNext) throw new Error('state medium is unreadable')
      return face.refuseNext ? { ok: false, message: 'nothing to reject' } : { ok: true, message: 'rejected ' + id }
    },
  }
  return face
}

/** One real host over the real routes: a bare http server dispatching by exact path. */
async function startHost(face: ApprovalFace): Promise<{ origin: string; close: () => Promise<void> }> {
  const routes = makeApprovalRoutes(face)
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
      await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      }))
    },
  }
}

const hosts: Array<{ close: () => Promise<void> }> = []
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
})

async function mount(face: Face): Promise<string> {
  const host = await startHost(face)
  hosts.push(host)
  return host.origin
}

describe('approval routes: the loopback fence', () => {
  it('admits only a loopback socket with a loopback Host and no cross-site marker', () => {
    const loopback: FenceRequest = { headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' } }
    expect(isLoopbackRequest(loopback)).toBe(true)
    expect(isLoopbackRequest({ ...loopback, socket: { remoteAddress: '10.0.0.9' } })).toBe(false)
    expect(isLoopbackRequest({ ...loopback, headers: { host: 'evil.example' } })).toBe(false)
    expect(isLoopbackRequest({ ...loopback, headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' } })).toBe(false)
  })

  it('refuses a rebound Host with 403 rather than answering the window', async () => {
    const face = makeFace()
    const origin = await mount(face)
    const status = await new Promise<number>((resolve, reject) => {
      const call = request(origin + APPROVAL_ROUTES.pending, { headers: { host: 'evil.example' } }, (response) => {
        response.resume()
        resolve(response.statusCode ?? 0)
      })
      call.on('error', reject)
      call.end()
    })
    expect(status).toBe(403)
    expect(face.calls).toEqual([])
  })
})

describe('approval routes: the pending window', () => {
  it('lists the pending records by default and hands the browser half rows, not raw records', async () => {
    const face = makeFace()
    const origin = await mount(face)
    const body = await (await fetch(origin + APPROVAL_ROUTES.pending)).json() as { ok: boolean; data: Array<Record<string, unknown>> }
    expect(face.calls).toEqual(['list:pending'])
    expect(body.ok).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({ id: 'p-1', kind: 'skill', summary: 'patch skill "alpha"', status: 'pending' })
    const age = body.data[0]?.age as { unit?: unknown; n?: unknown } | undefined
    expect(typeof age?.unit).toBe('string')
    expect(typeof age?.n).toBe('number')
    // The staged args never leave the host: the card shows what the record SAYS, and the preview (a
    // separate route) is what reads the payload.
    expect(body.data[0]).not.toHaveProperty('args')
  })

  it('passes an explicit status through and refuses an unknown one', async () => {
    const face = makeFace()
    const origin = await mount(face)
    const approved = await (await fetch(origin + APPROVAL_ROUTES.pending + '?status=approved')).json() as { data: Array<{ id: string }> }
    expect(face.calls).toEqual(['list:approved'])
    expect(approved.data.map(row => row.id)).toEqual(['p-2'])
    const bad = await fetch(origin + APPROVAL_ROUTES.pending + '?status=bogus')
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ ok: false, code: 'bad-request' })
  })
})

describe('approval routes: the two decisions', () => {
  it('forwards approve and reject, and answers with the service sentence', async () => {
    const face = makeFace()
    const origin = await mount(face)
    const approve = await (await fetch(origin + APPROVAL_ROUTES.approve, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'p-1' }),
    })).json() as { ok: boolean; data?: { message: string } }
    await fetch(origin + APPROVAL_ROUTES.reject, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'p-2' }),
    })
    expect(face.calls).toEqual(['approve:p-1', 'reject:p-2'])
    expect(approve).toMatchObject({ ok: true, data: { message: 'approved p-1' } })
  })

  it('keeps a business refusal at HTTP 200 with the service wording', async () => {
    const face = makeFace()
    face.refuseNext = true
    const origin = await mount(face)
    const response = await fetch(origin + APPROVAL_ROUTES.approve, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'gone' }),
    })
    expect(response.status).toBe(200)
    const refusal = await response.json() as { ok?: unknown; code?: unknown; message?: unknown }
    expect(refusal.ok).toBe(false)
    expect(refusal.code).toBe('approval-refused')
    expect(String(refusal.message)).toContain('pending window')
  })

  it('reports a service throw as an answer instead of an empty 500', async () => {
    const face = makeFace()
    face.failNext = true
    const origin = await mount(face)
    expect(await (await fetch(origin + APPROVAL_ROUTES.reject, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'p-1' }),
    })).json()).toMatchObject({ ok: false, code: 'approval-failed', message: 'state medium is unreadable' })
  })

  it('requires an id, the right method, and a JSON object body', async () => {
    const face = makeFace()
    const origin = await mount(face)
    const noId = await fetch(origin + APPROVAL_ROUTES.approve, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) })
    expect(noId.status).toBe(400)
    const wrongMethod = await fetch(origin + APPROVAL_ROUTES.approve)
    expect(wrongMethod.status).toBe(405)
    const noBody = await fetch(origin + APPROVAL_ROUTES.reject, { method: 'POST' })
    expect(noBody.status).toBe(400)
    expect(face.calls).toEqual([])
  })
})

describe('approval routes: the browser half mirrors the host table', () => {
  it('declares the same three literals under the same keys', () => {
    // Read as SOURCE on purpose: the browser half cannot import this package at runtime, so the only
    // way a rename can be caught in CI is by comparing the two textual tables.
    const source = readFileSync(new URL('../../evolution-settings-ui/src/client/approval-routes.ts', import.meta.url), 'utf8')
    for (const [key, path] of Object.entries(APPROVAL_ROUTES)) {
      expect(source, 'the browser half has no "' + key + '" path').toContain("'" + path + "'")
    }
    const literals = [...source.matchAll(/'\/api\/dsh-evolution\/approval\/[a-z]+'/g)].map(match => match[0].slice(1, -1))
    const published = new Set<string>(Object.values(APPROVAL_ROUTES))
    for (const literal of literals) expect(published.has(literal), 'the browser half invented ' + literal).toBe(true)
  })
})
