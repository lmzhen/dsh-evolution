/**
 * The skill-history HTTP surface: six exact Fetch routes over the curator's read/write seam (five
 * reads plus the one write).
 *
 * W6/G4: the carrier is the platform's Host connection data plane — the fence, browser auth and
 * owner-only admission are applied by the platform BEFORE `fetch(request)` runs, so this module has
 * no 403/401 branch. The wire envelope the browser half reads is unchanged.
 *
 * Layering: this module maps a route to a USE CASE and does nothing else. "Which artifact does this
 * version hold" and "how do the two chains split" live in evolution-core; the only write is
 * curator.undo. The panel never writes the skill tree itself.
 * @module @deepseek-ai/dsh-evolution-skill-history/routes
 */

import type { Context } from '@deepseek-ai/cordis'
import { undoableFor, unitUndoableFlags } from './unit-undoable.ts'
import { contentHash, displayBodyOf, elapsedSince, errorText, latestVersionAt, partitionVersions, skillRowCells, textDiffFacts, versionActionKind, versionRowCells } from '@deepseek-ai/dsh-evolution-core'
import { HOST_ROUTES, json, methodNotAllowed, readJsonObject } from '@deepseek-ai/dsh-evolution-core/http-routes'
import type { ConnectionFetchRouteLike, DecisionAudit } from '@deepseek-ai/dsh-evolution-core/http-routes'

/** Route paths: the ONE declaration lives in core (W1); the client constants are generated from it. */
export const SKILL_HISTORY_ROUTES = HOST_ROUTES.skillHistory

/**
 * How much of one version's body the read route hands back. A bound on the ANSWER, not on what the
 * deployment may store: a long skill arrives as its head plus `truncated`, so the reader is told.
 */
export const MAX_BODY_CHARS = 20_000

/** The curator surface the routes read: history() and the library listing, undo() as the only write. */
export type CuratorFace = Pick<Context['evolutionCurator'], 'history' | 'undo' | 'undoUnit' | 'skills'>

/**
 * What the handlers resolve PER REQUEST.
 *
 * The curator is looked up late, not captured: a profile that mounts these routes before the curator
 * (or without it) answers the family's own E-302 sentence instead of throwing, which is how every
 * other optional-service consumer in this family behaves.
 */
export interface RouteServices {
  readonly getCurator: () => CuratorFace | undefined
}

/**
 * Build the six routes over the curator seam.
 * @param services - the host services the handlers read.
 * @param _audit - the registration audit (read routes record nothing; undo's decision stays the
 *   curator's own — W6 keeps the ledger to the approval surface).
 * @returns the route list for `registerHostRoutes`.
 */
export function makeSkillHistoryRoutes(services: RouteServices, _audit: DecisionAudit): ConnectionFetchRouteLike[] {
  /** Run one handler body with the curator, or answer the family's E-302 sentence when it is absent. */
  const withCurator = async (run: (curator: CuratorFace) => Promise<Response>): Promise<Response> => {
    const curator = services.getCurator()
    if (curator === undefined) {
      return json(200, { ok: false, code: 'curator-not-mounted', message: errorText('e-302-curator-service-not-mounted') })
    }
    return await run(curator)
  }

  return [
    {
      path: SKILL_HISTORY_ROUTES.skills,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) => {
        if (request.method !== 'GET') return Promise.resolve(methodNotAllowed(['GET']))
        return withCurator(async (curator) => {
          const listed = await curator.skills.list()
          // The row carries what the LISTING already holds: the description and the two marker facts
          // cost no extra read, and they are what makes a left column answer "what is this" rather
          // than only "how many versions". Quality and last-use stay out on purpose — they live in
          // the curator's health view and the usage store, and joining them here would make this
          // route a second home for facts it does not own.
          const withHistory: Array<{
            name: string
            versions: number
            description: string
            managed: boolean
            protectedBy: string | null
            protectionUnknown: boolean
            lastAt: string | null
            age: ReturnType<typeof elapsedSince> | null
            cells: ReturnType<typeof skillRowCells>
          }> = []
          const now = Date.now()
          for (const skill of listed) {
            const versions = await curator.skills.listVersions(skill.name)
            if (versions.length === 0) continue
            // "Last changed" comes from the SAME index this row already reads, across both chains, so
            // no extra read and no second source. The words stay in the dictionary: the host answers
            // with the bucket and the row substitutes its `time.*` key, exactly like version rows.
            const lastAt = latestVersionAt(versions)
            const row = {
              name: skill.name,
              versions: versions.length,
              description: skill.description,
              managed: skill.managed,
              protectedBy: skill.protectedBy,
              protectionUnknown: skill.protectionUnknown,
              lastAt,
              age: lastAt === null ? null : elapsedSince(lastAt, now),
            }
            // The row's INFORMATION ARCHITECTURE is decided in core, not in the browser: which fact
            // leads, which one may be clipped and which one never may are pure functions over these
            // facts (`skill-row-cells.ts`). A browser half cannot import core at runtime — the client
            // build keeps every `@deepseek-ai/*` specifier external — so the cells travel with the row.
            withHistory.push({ ...row, cells: skillRowCells(row) })
          }
          return json(200, { ok: true, data: withHistory })
        })
      },
    },
    {
      path: SKILL_HISTORY_ROUTES.versions,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) => {
        if (request.method !== 'GET') return Promise.resolve(methodNotAllowed(['GET']))
        const name = new URL(request.url).searchParams.get('name')?.trim() ?? ''
        if (name === '') return Promise.resolve(json(400, { ok: false, code: 'bad-request', message: '缺少 name' }))
        return withCurator(async (curator) => {
          const versions = await curator.history(name)
          // The PANEL must not own the classification: core decides which entries hold the body
          // (partitionVersions) and the live bytes decide which one is already current, so the row
          // arrives with its own verdict and the browser half carries no rule of its own.
          const groups = partitionVersions(versions)
          const live = await curator.skills.read(name)
          const liveHash = live === null ? null : contentHash(live)
          // Everything a ROW needs is decided here, once: the artifact verdict (undoable), the
          // vocabulary key the face turns into words (actionKind), and the age bucket relative to
          // this request. The panel therefore owns no rule and no arithmetic — it substitutes words.
          // `charsDelta` is free (both counts are already in the index); the DIFF itself is a bigger
          // object and has its own route.
          const now = Date.now()
          type ChainEntry = typeof groups.content[number]
          const decorate = (entry: ChainEntry, index: number, chain: readonly ChainEntry[], withDelta: boolean) => {
            const previous = index === 0 ? undefined : chain[index - 1]
            return {
              ...entry,
              actionKind: versionActionKind(entry.action),
              age: elapsedSince(entry.at, now),
              // A delta is offered only where a DIFF is served: the diff route answers for the body
              // chain, so advertising one on a support row would render a refusal as an error.
              ...!withDelta || previous === undefined ? {} : { charsDelta: entry.chars - previous.chars },
            }
          }
          // G3b: one unit, one answer — the flag is aggregated over content AND support members, so a
          // row can never offer (or hide) an undo that belongs to a sibling shard.
          const unitFlags = unitUndoableFlags([...groups.content, ...groups.support], liveHash)
          const content = groups.content.map((entry, index) => {
            const undoable = undoableFor(entry, unitFlags, liveHash)
            const row = { ...decorate(entry, index, groups.content, true), ...undoable === undefined ? {} : { undoable } }
            return { ...row, cells: versionRowCells(row) }
          })
          const support = groups.support.map((entry, index) => {
            const row = decorate(entry, index, groups.support, false)
            return { ...row, cells: versionRowCells(row) }
          })
          return json(200, { ok: true, data: { content, support, liveHash } })
        })
      },
    },
    {
      path: SKILL_HISTORY_ROUTES.diff,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) => {
        if (request.method !== 'GET') return Promise.resolve(methodNotAllowed(['GET']))
        const params = new URL(request.url).searchParams
        const name = params.get('name')?.trim() ?? ''
        const rawV = params.get('v')?.trim() ?? ''
        const v = Number.parseInt(rawV, 10)
        if (name === '' || !/^\d+$/.test(rawV) || !Number.isInteger(v) || v < 1) {
          return Promise.resolve(json(400, { ok: false, code: 'bad-request', message: '需要 name 与正整数 v' }))
        }
        return withCurator(async (curator) => {
          const groups = partitionVersions(await curator.history(name))
          const index = groups.content.findIndex(entry => entry.v === v)
          if (index === -1) {
            return json(404, { ok: false, code: 'not-found', message: '该版本不在「' + name + '」的记录历史里' })
          }
          const entry = groups.content[index]
          // `beforeHash` is the AUTHORITATIVE predecessor (core computes it from the bytes a write lock
          // actually read); the array position is only the fallback for entries written before the link
          // existed. Two writers of one skill interleave in the index, so position can name the wrong
          // version — and the platform's own order rebuild already treats this as the authority.
          const linked = entry === undefined || entry.beforeHash === undefined
            ? undefined
            : groups.content.find(candidate => candidate.hash === entry.beforeHash)
          const previous = (linked ?? (index === 0 ? undefined : groups.content[index - 1]))
          // The FIRST version is compared against nothing, which the same function reports honestly
          // as "everything is new" — no second code path for it.
          const after = entry === undefined ? null : await curator.skills.readVersion(name, v)
          const before = previous === undefined ? '' : await curator.skills.readVersion(name, previous.v)
          if (after === null || before === null) {
            return json(404, { ok: false, code: 'not-found', message: '该版本的存储内容读不出来' })
          }
          const facts = textDiffFacts(before, after, 'SKILL.md')
          return json(200, { ok: true, data: { v, against: previous?.v ?? null, ...facts } })
        })
      },
    },
    {
      path: SKILL_HISTORY_ROUTES.body,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) => {
        if (request.method !== 'GET') return Promise.resolve(methodNotAllowed(['GET']))
        const params = new URL(request.url).searchParams
        const name = params.get('name')?.trim() ?? ''
        const rawV = params.get('v')?.trim() ?? ''
        const v = Number.parseInt(rawV, 10)
        if (name === '' || !/^\d+$/.test(rawV) || !Number.isInteger(v) || v < 1) {
          return Promise.resolve(json(400, { ok: false, code: 'bad-request', message: '需要 name 与正整数 v' }))
        }
        return withCurator(async (curator) => {
          // The same read the undo path and the diff route use, so a version has ONE reader.
          const text = await curator.skills.readVersion(name, v)
          if (text === null) return json(404, { ok: false, code: 'not-found', message: '该版本的存储内容读不出来' })
          const truncated = text.length > MAX_BODY_CHARS
          const head = truncated ? text.slice(0, MAX_BODY_CHARS) : text
          // What the version SAYS, not the bytes it stores: the frontmatter block is metadata the row
          // and the left column already carry, and the platform renderer reads its closing `---` as a
          // setext underline, which made the metadata line the document's biggest heading (W19). The
          // exact bytes stay one route away, in the diff. Core owns the policy (`displayBodyOf`), and
          // a browser half cannot import core at runtime, so the host applies it.
          return json(200, {
            ok: true,
            data: { v, display: displayBodyOf(head), chars: text.length, truncated },
          })
        })
      },
    },
    {
      path: SKILL_HISTORY_ROUTES.undo,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => {
        if (request.method !== 'POST') return Promise.resolve(methodNotAllowed(['POST']))
        return (async () => {
          const payload = await readJsonObject(request)
          const name = typeof payload?.name === 'string' ? payload.name.trim() : ''
          if (name === '') return json(400, { ok: false, code: 'bad-request', message: '缺少 name' })
          const raw = payload?.v
          if (raw !== undefined && (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1)) {
            return json(400, { ok: false, code: 'bad-request', message: 'v 必须是正整数' })
          }
          const unitId = typeof payload?.unitId === 'string' ? payload.unitId.trim() : ''
          if (raw !== undefined && unitId !== '') {
            return json(400, { ok: false, code: 'bad-request', message: 'v 与 unitId 不能同时使用' })
          }
          return withCurator(async (curator) => {
            const result = unitId !== ''
              ? await curator.undoUnit(name, unitId)
              : raw === undefined ? await curator.undo(name) : await curator.undo(name, raw)
            // A refusal is a BUSINESS answer, not a transport failure: the body carries the curator's own
            // sentence (the same one the slash command prints), so the two faces cannot drift.
            return json(200, result.ok ? { ok: true, data: result } : { ok: false, code: 'undo-refused', message: result.message })
          })
        })()
      },
    },
    {
      path: SKILL_HISTORY_ROUTES.health,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) => {
        if (request.method !== 'GET') return Promise.resolve(methodNotAllowed(['GET']))
        return Promise.resolve(json(200, { ok: true, data: { surface: 'skill-history' } }))
      },
    },
  ]
}
