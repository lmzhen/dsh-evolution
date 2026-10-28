/**
 * The host route this bundle reads, and the ONE place a request is made.
 *
 * G5/W7: the path comes from the generated client route table (rendered from evolution-core
 * HOST_ROUTES) and the transport is the shared generated route-client. A refusal arrives classified
 * with the host's own sentence, so the panel shows what the route actually said.
 * @module @deepseek-ai/dsh-evolution-skill-health/client
 */
import { ROUTES } from '@lmzhen/dsh-evolution-client-kit/generated/routes'
import { requestJson } from '@lmzhen/dsh-evolution-client-kit/generated/route-client'
import type { RouteFailure } from '@lmzhen/dsh-evolution-client-kit/generated/route-client'
import type { HealthProposal, HealthRow } from './Panel.ts'

/** Route paths: the generated mirror of the host's HOST_ROUTES (one declaration in core). */
export const HOST_ROUTES = ROUTES['skill-health']

/** One scan result, as the route reports it. */
export interface HealthPayload {
  rows: HealthRow[]
  /** True when the host could not finish the scan: the counts below are then a lower bound. */
  truncated: boolean
  readAt?: number
  scan?: { status: 'complete' | 'unavailable' | 'truncated' }
  proposals?: HealthProposal[]
  proposalStatus?: 'available' | 'unavailable' | 'stale'
}

/** Either the payload or the classified four-state failure — never a thrown error the panel must guess at. */
export type HealthOutcome = { ok: true; payload: HealthPayload } | { ok: false; failure: RouteFailure }

/**
 * Read the scan result.
 * @returns the payload, or the host's own refusal sentence.
 */
export async function rows(): Promise<HealthOutcome> {
  const answer = await requestJson<HealthPayload>(fetch, HOST_ROUTES.rows, { headers: { accept: 'application/json' } })
  if (!answer.ok) return { ok: false, failure: answer.failure }
  return { ok: true, payload: {
    rows: answer.data.rows,
    truncated: answer.data.truncated,
    ...(answer.data.readAt === undefined ? {} : { readAt: answer.data.readAt }),
    ...(answer.data.scan === undefined ? {} : { scan: answer.data.scan }),
    ...(answer.data.proposals === undefined ? {} : { proposals: answer.data.proposals }),
    ...(answer.data.proposalStatus === undefined ? {} : { proposalStatus: answer.data.proposalStatus }),
  } }
}
