/**
 * The host routes this bundle calls, and the ONE place a request is made.
 *
 * The paths mirror the host half's `SKILL_HISTORY_ROUTES` (a spec asserts the two sides agree). Every
 * refusal arrives as `ok:false` plus the curator's own sentence, so the panel shows the same words the
 * slash command prints instead of inventing a second vocabulary.
 * @module @deepseek-ai/dsh-evolution-skill-history/client
 */

/** Route paths, mirrored from the host half. */
export const HOST_ROUTES = {
  skills: '/api/dsh-evolution/skill-history/skills',
  versions: '/api/dsh-evolution/skill-history/versions',
  undo: '/api/dsh-evolution/skill-history/undo',
} as const

/** One recorded version, as the host reports it. */
export interface VersionRow {
  readonly v: number
  readonly at: string
  readonly action: string
  readonly hash: string
  readonly chars: number
  /** Present on body rows: false when this version already IS the live content. */
  readonly undoable?: boolean
}

/** One skill that has recorded versions. */
export interface SkillRow {
  readonly name: string
  readonly versions: number
}

/** The two chains, plus the live body hash the panel marks as "current". */
export interface VersionsPayload {
  readonly content: readonly VersionRow[]
  readonly support: readonly VersionRow[]
  readonly liveHash: string | null
}

/** The panel's data face: plain callbacks, no service handle. */
export interface SkillHistoryApi {
  readonly skills: () => Promise<readonly SkillRow[]>
  readonly versions: (name: string) => Promise<VersionsPayload>
  readonly undo: (name: string, v?: number) => Promise<string>
}

/** A refusal the host reported, carrying its own sentence (the curator's, not ours). */
export class SkillHistoryRefusal extends Error {}

/**
 * Build the panel's face over one fetch implementation.
 * @param fetchImpl - the fetch to use; a spec passes a stub.
 * @returns the three callbacks the component receives through its inject face.
 */
export function createSkillHistoryApi(fetchImpl: typeof fetch = fetch): SkillHistoryApi {
  const request = async (path: string, init?: RequestInit): Promise<unknown> => {
    const response = await fetchImpl(path, init)
    if (!response.ok) throw new SkillHistoryRefusal('HTTP ' + String(response.status))
    const body = await response.json() as { ok?: boolean; data?: unknown; message?: string }
    if (body.ok !== true) throw new SkillHistoryRefusal(body.message ?? 'request refused')
    return body.data
  }
  return {
    skills: async () => await request(HOST_ROUTES.skills) as readonly SkillRow[],
    versions: async (name: string) => await request(HOST_ROUTES.versions + '?name=' + encodeURIComponent(name)) as VersionsPayload,
    undo: async (name: string, v?: number) => {
      const data = await request(HOST_ROUTES.undo, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(v === undefined ? { name } : { name, v }),
      }) as { message: string }
      return data.message
    },
  }
}
