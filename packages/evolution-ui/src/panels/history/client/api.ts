/**
 * The host routes this bundle calls, and the ONE place a request is made.
 *
 * G5/W7: the paths come from the generated client route table (rendered from evolution-core
 * HOST_ROUTES), and the transport classifier is the shared generated route-client — the browser half
 * can no longer drift from the host table or grow a second HTTP vocabulary.
 * @module @deepseek-ai/dsh-evolution-skill-history/client
 */
import { ROUTES } from '@lmzhen/dsh-evolution-client-kit/generated/routes'
import { failureMessage, requestJson } from '@lmzhen/dsh-evolution-client-kit/generated/route-client'
import type { RouteFailure } from '@lmzhen/dsh-evolution-client-kit/generated/route-client'

/** Route paths: the generated mirror of the host's HOST_ROUTES (one declaration in core). */
export const HOST_ROUTES = ROUTES['skill-history']

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
  /** Present when this row belongs to a cross-skill write unit; undo then restores the whole unit. */
  readonly unitId?: string
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

/**
 * The two chains. G4.2 whitelist audit: the payload's `liveHash` is DELETED here — the host route already
 * compares it (`undoable: entry.hash !== liveHash`, routes.ts) and delivers the verdict per row, so the
 * "current" marker has one source. A declared field nobody reads is drift waiting to happen.
 */
export interface VersionsPayload {
  readonly content: readonly VersionRow[]
  readonly support: readonly VersionRow[]
}

/** The panel's data face: plain callbacks, no service handle. */
export interface SkillHistoryApi {
  readonly skills: () => Promise<readonly SkillRow[]>
  readonly versions: (name: string) => Promise<VersionsPayload>
  readonly undo: (name: string, v?: number, unitId?: string) => Promise<string>
  readonly diff: (name: string, v: number) => Promise<VersionDiffRow>
  readonly body: (name: string, v: number) => Promise<VersionBodyRow>
}

/**
 * A refusal the host reported, carrying its own sentence (the curator's, not ours) and the classified
 * four-state failure so the panel can render the shared failure block (G5/W7 S6b).
 */
export class SkillHistoryRefusal extends Error {
  readonly failure: RouteFailure

  constructor(failure: RouteFailure) {
    super(failureMessage(failure))
    this.name = 'SkillHistoryRefusal'
    this.failure = failure
  }
}

/**
 * Build the panel's face over one fetch implementation.
 * @param fetchImpl - the fetch to use; a spec passes a stub.
 * @returns the three callbacks the component receives through its inject face.
 */
export function createSkillHistoryApi(fetchImpl: typeof fetch = fetch): SkillHistoryApi {
  const request = async (path: string, init?: RequestInit): Promise<unknown> => {
    const answer = await requestJson<unknown>(fetchImpl, path, init)
    if (!answer.ok) throw new SkillHistoryRefusal(answer.failure)
    return answer.data
  }
  return {
    skills: async () => await request(HOST_ROUTES.skills) as readonly SkillRow[],
    versions: async (name: string) => await request(HOST_ROUTES.versions + '?name=' + encodeURIComponent(name)) as VersionsPayload,
    diff: async (name: string, v: number) => await request(HOST_ROUTES.diff + '?name=' + encodeURIComponent(name) + '&v=' + String(v)) as VersionDiffRow,
    body: async (name: string, v: number) => await request(HOST_ROUTES.body + '?name=' + encodeURIComponent(name) + '&v=' + String(v)) as VersionBodyRow,
    undo: async (name: string, v?: number, unitId?: string) => {
      const data = await request(HOST_ROUTES.undo, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(unitId !== undefined && unitId !== '' ? { name, unitId } : v === undefined ? { name } : { name, v }),
      }) as { message: string }
      return data.message
    },
  }
}
