// @tier pre-tag
/**
 * The approval route surface on the platform's exact Fetch carrier (W6/G4).
 *
 * The trust fence, browser auth and owner-only admission are the PLATFORM's now; this spec exercises
 * the family's own contract through the carrier harness: exact path + method selection, the business
 * envelope (a refusal stays HTTP 200 with the service sentence), the DecisionAudit rolled into
 * approve/reject, and the preview diff facts.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { PendingRecord, PendingStatus } from '@deepseek-ai/dsh-evolution-state-storage'
import type { DecisionAudit } from '@deepseek-ai/dsh-evolution-core/http-routes'
import { mountHostRoutes } from '../../test-support/host-route-harness.ts'
import { APPROVAL_ROUTES, makeApprovalRoutes, type ApprovalFace } from '../src/routes.ts'
import type { WritePreview } from '../src/index.ts'

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
  readonly audits: DecisionAudit[]
  failNext: boolean
  refuseNext: boolean
  preview: WritePreview | undefined
}

function makeFace(): Face {
  const face: Face = {
    calls: [],
    audits: [],
    failNext: false,
    refuseNext: false,
    preview: undefined,
    previewOf: () => face.preview,
    list: async (status: PendingStatus = 'pending') => {
      face.calls.push('list:' + status)
      const all = [record(), record({ id: 'p-2', status: 'approved', summary: 'memory op' })]
      return all.filter(candidate => candidate.status === status)
    },
    approve: async (id: string, audit: DecisionAudit) => {
      face.calls.push('approve:' + id)
      face.audits.push(audit)
      if (face.failNext) throw new Error('state medium is unreadable')
      return face.refuseNext ? { ok: false, message: 'pending record "x" is not in the pending window' } : { ok: true, message: 'approved ' + id }
    },
    reject: async (id: string, audit: DecisionAudit) => {
      face.calls.push('reject:' + id)
      face.audits.push(audit)
      if (face.failNext) throw new Error('state medium is unreadable')
      return face.refuseNext ? { ok: false, message: 'nothing to reject' } : { ok: true, message: 'rejected ' + id }
    },
  }
  return face
}

async function mount(face: Face) {
  const ctx = new Context()
  return await mountHostRoutes(ctx, (audit) => makeApprovalRoutes(face, audit))
}

describe('approval routes: the platform carrier selects by exact path', () => {
  it('answers 404 for a path that is not registered (the shared RPC fall-through)', async () => {
    const face = makeFace()
    const host = await mount(face)
    const { status } = await host.json('/api/dsh-evolution/approval/unknown')
    expect(status).toBe(404)
    expect(face.calls).toEqual([])
  })

  it('never sees a non-owner principal: the platform refuses before fetch (403)', async () => {
    const face = makeFace()
    const ctx = new Context()
    const host = await mountHostRoutes(ctx, (audit) => makeApprovalRoutes(face, audit), { principal: 'other' })
    const { status } = await host.json(APPROVAL_ROUTES.pending)
    expect(status).toBe(403)
    expect(face.calls).toEqual([])
  })
})

describe('approval routes: the pending window', () => {
  it('lists the pending records by default and hands the browser half rows, not raw records', async () => {
    const face = makeFace()
    const host = await mount(face)
    const { status, body } = await host.json<{ ok: boolean; data: Array<Record<string, unknown>> }>(APPROVAL_ROUTES.pending)
    expect(status).toBe(200)
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
    const host = await mount(face)
    const approved = await host.json<{ data: Array<{ id: string }> }>(APPROVAL_ROUTES.pending + '?status=approved')
    expect(face.calls).toEqual(['list:approved'])
    expect(approved.body.data.map(row => row.id)).toEqual(['p-2'])
    const bad = await host.json(APPROVAL_ROUTES.pending + '?status=bogus')
    expect(bad.status).toBe(400)
    expect(bad.body).toMatchObject({ ok: false, code: 'bad-request' })
  })
})

describe('approval routes: the two decisions', () => {
  it('forwards approve and reject with the registration audit, and answers with the service sentence', async () => {
    const face = makeFace()
    const host = await mount(face)
    const approve = await host.json<{ ok: boolean; data?: { message: string } }>(APPROVAL_ROUTES.approve, { method: 'POST', body: { id: 'p-1' } })
    await host.call(APPROVAL_ROUTES.reject, { method: 'POST', body: { id: 'p-2' } })
    expect(face.calls).toEqual(['approve:p-1', 'reject:p-2'])
    expect(approve.body).toMatchObject({ ok: true, data: { message: 'approved p-1' } })
    // W6: the decision carries the platform's OWN admission facts, captured where connection is known.
    expect(face.audits).toEqual([
      { channel: 'connection.fetch', principal: 'owner', deploymentAllowsRemote: false },
      { channel: 'connection.fetch', principal: 'owner', deploymentAllowsRemote: false },
    ])
  })

  it('reports deploymentAllowsRemote truthfully when the carrier allows remote authorities', async () => {
    const face = makeFace()
    const ctx = new Context()
    const host = await mountHostRoutes(ctx, (audit) => makeApprovalRoutes(face, audit), { allowsRemoteAuthorities: true })
    await host.call(APPROVAL_ROUTES.approve, { method: 'POST', body: { id: 'p-1' } })
    expect(face.audits[0]?.deploymentAllowsRemote).toBe(true)
  })

  it('keeps a business refusal at HTTP 200 with the service wording', async () => {
    const face = makeFace()
    face.refuseNext = true
    const host = await mount(face)
    const { status, body } = await host.json<{ ok?: unknown; code?: unknown; message?: unknown }>(APPROVAL_ROUTES.approve, { method: 'POST', body: { id: 'gone' } })
    expect(status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.code).toBe('approval-refused')
    expect(String(body.message)).toContain('pending window')
  })

  it('reports a service throw as an answer instead of an empty 500', async () => {
    const face = makeFace()
    face.failNext = true
    const host = await mount(face)
    const { body } = await host.json(APPROVAL_ROUTES.reject, { method: 'POST', body: { id: 'p-1' } })
    expect(body).toMatchObject({ ok: false, code: 'approval-failed', message: 'state medium is unreadable' })
  })

  it('requires an id and a JSON object body; undeclared methods never reach the route', async () => {
    const face = makeFace()
    const host = await mount(face)
    const noId = await host.json(APPROVAL_ROUTES.approve, { method: 'POST', body: {} })
    expect(noId.status).toBe(400)
    // The platform falls through for a method the exact route did not declare (the route lists POST).
    const wrongMethod = await host.json(APPROVAL_ROUTES.approve)
    expect(wrongMethod.status).toBe(404)
    const noBody = await host.json(APPROVAL_ROUTES.reject, { method: 'POST' })
    expect(noBody.status).toBe(400)
    expect(face.calls).toEqual([])
  })
})

describe('approval routes: the preview', () => {
  it('resolves one staged write into the same diff facts the history diff route uses', async () => {
    const face = makeFace()
    face.preview = async () => ({ available: true, path: 'SKILL.md', before: 'a\nb\n', after: 'a\nc\n' })
    const host = await mount(face)
    const body = await host.json<{ ok: boolean; data: Record<string, unknown> }>(APPROVAL_ROUTES.preview + '?id=p-1')
    expect(body.body.ok).toBe(true)
    expect(body.body.data).toMatchObject({ available: true, path: 'SKILL.md', linesAdded: 1, linesRemoved: 1 })
    expect(Array.isArray(body.body.data.hunks)).toBe(true)
  })

  it('passes a refusal through as an answer, and says so when the kind has no preview', async () => {
    const refusing = makeFace()
    refusing.preview = async () => ({ available: false, reason: 'the target changed after it was staged' })
    const refusingHost = await mount(refusing)
    expect((await refusingHost.json(APPROVAL_ROUTES.preview + '?id=p-1')).body)
      .toMatchObject({ ok: true, data: { available: false, reason: 'the target changed after it was staged' } })

    const bare = makeFace()
    const bareHost = await mount(bare)
    const bareBody = await bareHost.json<{ ok?: unknown; data?: { available?: unknown; reason?: unknown } }>(APPROVAL_ROUTES.preview + '?id=p-1')
    expect(bareBody.body.ok).toBe(true)
    expect(bareBody.body.data?.available).toBe(false)
    expect(String(bareBody.body.data?.reason)).toContain('没有可预览内容')
  })

  it('answers an unknown id as a business miss, and a missing id as a bad request', async () => {
    const face = makeFace()
    const host = await mount(face)
    const unknown = await host.json(APPROVAL_ROUTES.preview + '?id=nope')
    expect(unknown.status).toBe(200)
    expect(unknown.body).toMatchObject({ ok: false, code: 'not-found' })
    expect((await host.json(APPROVAL_ROUTES.preview)).status).toBe(400)
  })
})

describe('approval routes: the browser half mirrors the host table', () => {
  it('declares the same four literals under the same keys', async () => {
    // Read as SOURCE on purpose: the browser half cannot import this package at runtime, so the only
    // way a rename can be caught in CI is by comparing the two textual tables (the generated client
    // constant is the G5 artifact; until then the settings-ui copy is the mirror under test).
    const source = readFileSync(new URL('../../evolution-settings-ui/src/client/approval-routes.ts', import.meta.url), 'utf8')
    for (const [key, path] of Object.entries(APPROVAL_ROUTES)) {
      expect(source, 'the browser half has no "' + key + '" path').toContain("'" + path + "'")
    }
    const literals = [...source.matchAll(/'\/api\/dsh-evolution\/approval\/[a-z]+'/g)].map(match => match[0].slice(1, -1))
    const published = new Set<string>(Object.values(APPROVAL_ROUTES))
    for (const literal of literals) expect(published.has(literal), 'the browser half invented ' + literal).toBe(true)
  })
})
