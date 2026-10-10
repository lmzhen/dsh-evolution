/**
 * The skill-history HTTP surface: six loopback routes over the curator's read/write seam (five reads plus the one write).
 *
 * Layering: this module maps a route to a USE CASE and does nothing else. "Which artifact does this
 * version hold" and "how do the two chains split" live in evolution-core; the only write is
 * curator.undo. The panel never writes the skill tree itself.
 * @module @deepseek-ai/dsh-evolution-skill-history/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { contentHash, displayBodyOf, elapsedSince, errorText, isLoopbackRequest, latestVersionAt, partitionVersions, readJsonObject, skillRowCells, textDiffFacts, versionActionKind, versionRowCells, writeJson } from '@deepseek-ai/dsh-evolution-core'

/** Route paths. The client bundle mirrors these literals; a spec asserts the two sides agree. */
export const SKILL_HISTORY_ROUTES = {
  skills: '/api/dsh-evolution/skill-history/skills',
  versions: '/api/dsh-evolution/skill-history/versions',
  diff: '/api/dsh-evolution/skill-history/versions/diff',
  body: '/api/dsh-evolution/skill-history/versions/body',
  undo: '/api/dsh-evolution/skill-history/undo',
  health: '/api/dsh-evolution/skill-history/health',
} as const

/**
 * How much of one version's body the read route hands back. A bound on the ANSWER, not on what the
 * deployment may store: a long skill arrives as its head plus `truncated`, so the reader is told.
 */
export const MAX_BODY_CHARS = 20_000

/** The curator surface the routes read: history() and the library listing, undo() as the only write. */
export type CuratorFace = Pick<Context['evolutionCurator'], 'history' | 'undo' | 'skills'>

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
 * @returns the route list for ctx.webServer.register.
 */
export function makeSkillHistoryRoutes(services: RouteServices): WebRoute[] {
  /** Run one handler body with the curator, or answer the family's E-302 sentence when it is absent. */
  const withCurator = async (res: ServerResponse, run: (curator: CuratorFace) => Promise<void>): Promise<void> => {
    const curator = services.getCurator()
    if (curator === undefined) {
      writeJson(res, 200, { ok: false, code: 'curator-not-mounted', message: errorText('e-302-curator-service-not-mounted') })
      return
    }
    await run(curator)
  }
  /** Guard: trust fence, then method. Every refusal is a JSON body, never an empty response. */
  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: 'method not allowed: ' + (req.method ?? '') })
      return false
    }
    return true
  }
  return [
    {
      kind: 'exact',
      path: SKILL_HISTORY_ROUTES.skills,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        await withCurator(res, async (curator) => {
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
          writeJson(res, 200, { ok: true, data: withHistory })
        })
      },
    },
    {
      kind: 'exact',
      path: SKILL_HISTORY_ROUTES.versions,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const name = new URL(req.url ?? '/', 'http://loopback').searchParams.get('name')?.trim() ?? ''
        if (name === '') {
          writeJson(res, 400, { ok: false, code: 'bad-request', message: 'name is required' })
          return
        }
        await withCurator(res, async (curator) => {
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
          const content = groups.content.map((entry, index) => {
            const row = { ...decorate(entry, index, groups.content, true), undoable: entry.hash !== liveHash }
            return { ...row, cells: versionRowCells(row) }
          })
          const support = groups.support.map((entry, index) => {
            const row = decorate(entry, index, groups.support, false)
            return { ...row, cells: versionRowCells(row) }
          })
          writeJson(res, 200, { ok: true, data: { content, support, liveHash } })
        })
      },
    },
    {
      kind: 'exact',
      path: SKILL_HISTORY_ROUTES.diff,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const params = new URL(req.url ?? '/', 'http://loopback').searchParams
        const name = params.get('name')?.trim() ?? ''
        const rawV = params.get('v')?.trim() ?? ''
        const v = Number.parseInt(rawV, 10)
        if (name === '' || !/^\d+$/.test(rawV) || !Number.isInteger(v) || v < 1) {
          writeJson(res, 400, { ok: false, code: 'bad-request', message: 'name and a positive integer v are required' })
          return
        }
        await withCurator(res, async (curator) => {
          const groups = partitionVersions(await curator.history(name))
          const index = groups.content.findIndex(entry => entry.v === v)
          if (index === -1) {
            writeJson(res, 404, { ok: false, code: 'not-found', message: 'that version is not in the recorded history of "' + name + '"' })
            return
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
            writeJson(res, 404, { ok: false, code: 'not-found', message: 'the stored content of that version could not be read' })
            return
          }
          const facts = textDiffFacts(before, after, 'SKILL.md')
          writeJson(res, 200, { ok: true, data: { v, against: previous?.v ?? null, ...facts } })
        })
      },
    },
    {
      kind: 'exact',
      path: SKILL_HISTORY_ROUTES.body,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const params = new URL(req.url ?? '/', 'http://loopback').searchParams
        const name = params.get('name')?.trim() ?? ''
        const rawV = params.get('v')?.trim() ?? ''
        const v = Number.parseInt(rawV, 10)
        if (name === '' || !/^\d+$/.test(rawV) || !Number.isInteger(v) || v < 1) {
          writeJson(res, 400, { ok: false, code: 'bad-request', message: 'name and a positive integer v are required' })
          return
        }
        await withCurator(res, async (curator) => {
          // The same read the undo path and the diff route use, so a version has ONE reader.
          const text = await curator.skills.readVersion(name, v)
          if (text === null) {
            writeJson(res, 404, { ok: false, code: 'not-found', message: 'the stored content of that version could not be read' })
            return
          }
          const truncated = text.length > MAX_BODY_CHARS
          const head = truncated ? text.slice(0, MAX_BODY_CHARS) : text
          // What the version SAYS, not the bytes it stores: the frontmatter block is metadata the row
          // and the left column already carry, and the platform renderer reads its closing `---` as a
          // setext underline, which made the metadata line the document's biggest heading (W19). The
          // exact bytes stay one route away, in the diff. Core owns the policy (`displayBodyOf`), and
          // a browser half cannot import core at runtime, so the host applies it.
          writeJson(res, 200, {
            ok: true,
            data: { v, display: displayBodyOf(head), chars: text.length, truncated },
          })
        })
      },
    },
    {
      kind: 'exact',
      path: SKILL_HISTORY_ROUTES.undo,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const payload = await readJsonObject(req)
        const name = typeof payload?.name === 'string' ? payload.name.trim() : ''
        if (name === '') {
          writeJson(res, 400, { ok: false, code: 'bad-request', message: 'name is required' })
          return
        }
        const raw = payload?.v
        if (raw !== undefined && (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1)) {
          writeJson(res, 400, { ok: false, code: 'bad-request', message: 'v must be a positive integer' })
          return
        }
        await withCurator(res, async (curator) => {
          const result = raw === undefined ? await curator.undo(name) : await curator.undo(name, raw)
          // A refusal is a BUSINESS answer, not a transport failure: the body carries the curator's own
          // sentence (the same one the slash command prints), so the two faces cannot drift.
          writeJson(res, 200, result.ok ? { ok: true, data: result } : { ok: false, code: 'undo-refused', message: result.message })
        })
      },
    },
    {
      kind: 'exact',
      path: SKILL_HISTORY_ROUTES.health,
      handler: (req, res) => {
        if (!guard(req, res, 'GET')) return
        writeJson(res, 200, { ok: true, data: { surface: 'skill-history' } })
      },
    },
  ]
}
