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
  diff: '/api/dsh-evolution/skill-history/versions/diff',
  body: '/api/dsh-evolution/skill-history/versions/body',
  undo: '/api/dsh-evolution/skill-history/undo',
} as const

/** One changed region, as the host reports it (the platform diff card's own shape). */
export interface DiffHunkRow {
  readonly path: string
  readonly oldText: string
  readonly newText: string
}

/** One version's diff, as the host computes it. */
export interface VersionDiffRow {
  readonly v: number
  /** The version this one replaced, or null for the first recorded version. */
  readonly against: number | null
  readonly linesAdded: number
  readonly linesRemoved: number
  readonly hunks: readonly DiffHunkRow[]
  readonly truncated: boolean
}

/** Where a cell sits in its row: `aside` is right-aligned and is never truncated. */
export type CellSlot = 'lead' | 'meta' | 'aside'

/** The visual register a cell speaks in; the stylesheet maps it to a scale token. */
export type CellTone = 'primary' | 'secondary' | 'tertiary'

/** One cell of a row: a locale key with the values its template needs, or a verbatim fact. */
export type RowCell =
  | {
    readonly key: string
    readonly slot: CellSlot
    readonly tone: CellTone
    readonly note?: string
    readonly copy: string
    readonly values?: Readonly<Record<string, string | number>>
  }
  | {
    readonly key: string
    readonly slot: CellSlot
    readonly tone: CellTone
    readonly note?: string
    readonly literal: string
  }

/** The lines one row shows: a title line, and a meta line under it. */
export interface RowCells {
  readonly title: readonly RowCell[]
  readonly meta: readonly RowCell[]
}

/** One recorded version, as the host reports it. */
export interface VersionRow {
  readonly v: number
  readonly at: string
  readonly action: string
  readonly hash: string
  readonly chars: number
  /** Present on body rows: false when this version already IS the live content. */
  readonly undoable?: boolean
  /** Characters this version added to (or removed from) the one before it; absent on the first. */
  readonly charsDelta?: number
  /** Which kind of write produced it (the vocabulary key the panel turns into words). */
  readonly actionKind: string
  /** How long ago the host recorded it, as a bucket plus a count — never a sentence. */
  readonly age: { readonly unit: string; readonly n: number }
  /** What this row says and where each fact sits, decided in core (`skill-row-cells.ts`). */
  readonly cells: RowCells
  /** The one line the optional summarizer wrote, when the deployment turned it on. */
  readonly summary?: string
  /**
   * Which support file these bytes came from, relative to the skill directory. Absent on body rows,
   * and absent on every support row recorded before the field existed (the bytes carry no name).
   */
  readonly path?: string
}

/** One skill that has recorded versions, with what the listing already knows about it. */
export interface SkillRow {
  readonly name: string
  readonly versions: number
  readonly description: string
  readonly managed: boolean
  readonly protectedBy: string | null
  readonly protectionUnknown: boolean
  /** When this skill's content last changed (either chain), or null when the index is empty. */
  readonly lastAt: string | null
  /** That moment as a bucket plus a count; null exactly when `lastAt` is. */
  readonly age: { readonly unit: string; readonly n: number } | null
  /** What this row says and where each fact sits, decided in core (`skill-row-cells.ts`). */
  readonly cells: RowCells
}

/** One version's whole body, as the read route hands it over. */
export interface VersionBodyRow {
  readonly v: number
  /**
   * The text a READER sees: the body without its frontmatter block, or its head when `truncated` —
   * the reader is told rather than silently cut. The exact bytes are the diff route's answer.
   */
  readonly display: string
  /** How long the stored body is, whatever came back. */
  readonly chars: number
  readonly truncated: boolean
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
  readonly diff: (name: string, v: number) => Promise<VersionDiffRow>
  readonly body: (name: string, v: number) => Promise<VersionBodyRow>
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
    diff: async (name: string, v: number) => await request(HOST_ROUTES.diff + '?name=' + encodeURIComponent(name) + '&v=' + String(v)) as VersionDiffRow,
    body: async (name: string, v: number) => await request(HOST_ROUTES.body + '?name=' + encodeURIComponent(name) + '&v=' + String(v)) as VersionBodyRow,
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
