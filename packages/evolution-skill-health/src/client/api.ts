/**
 * The host route this bundle reads, and the ONE place a request is made.
 *
 * The path mirrors the host half's `ROUTES.rows` in `src/routes.ts` (a spec asserts the two sides
 * agree). A refusal arrives as `ok:false` with the host's own sentence, so the panel shows what the
 * route actually said instead of inventing a second vocabulary.
 * @module @deepseek-ai/dsh-evolution-skill-health/client
 */

import type { HealthRow } from './Panel.ts'

/** Route paths, mirrored from the host half. */
export const HOST_ROUTES = {
  rows: '/api/dsh-evolution/skill-health/rows',
} as const

/** One scan result, as the route reports it. */
export interface HealthPayload {
  rows: HealthRow[]
  /** True when the host could not finish the scan: the counts below are then a lower bound. */
  truncated: boolean
}

/** Either the payload or the host's refusal sentence — never a thrown error the panel must guess at. */
export type HealthOutcome = { ok: true; payload: HealthPayload } | { ok: false; message: string }

/**
 * Read the scan result.
 * @returns the payload, or the host's own refusal sentence.
 */
export async function rows(): Promise<HealthOutcome> {
  try {
    const response = await fetch(HOST_ROUTES.rows, { headers: { accept: 'application/json' } })
    const body = await response.json() as { message?: string } & Partial<HealthPayload>
    if (!response.ok) return { ok: false, message: body.message ?? 'skill-health: the route refused the request' }
    return { ok: true, payload: { rows: body.rows ?? [], truncated: body.truncated === true } }
  } catch (error) {
    return { ok: false, message: 'skill-health: ' + String(error) }
  }
}
