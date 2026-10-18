// @tier pre-tag
/**
 * The skill-history host routes on the platform's exact Fetch carrier (W6/G4).
 *
 * The old spec drove a REAL loopback http server because the fence read the socket. The fence is gone:
 * trust/browser-auth/owner admission are the platform's, so the contract under test is the family's
 * own — exact path selection, the curator seam (E-302 when absent), the split version chains, the
 * bounded JSON body and the undo write.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionCurator from '@deepseek-ai/dsh-evolution-curator'
import { DEFAULT_SKILL_LIMITS, SkillLibrary, MAX_REQUEST_BODY_BYTES, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { mountHostRoutes } from '../../test-support/host-route-harness.ts'
import { SKILL_HISTORY_ROUTES, makeSkillHistoryRoutes } from '../src/routes.ts'
import { tempHome } from '../../test-support/temp-home.ts'

describe('skill-history routes: the curator seam', () => {
  it('answers the family\'s E-302 sentence when the curator is not mounted', async () => {
    const ctx = new Context()
    const host = await mountHostRoutes(ctx, audit => makeSkillHistoryRoutes({ getCurator: () => undefined }, audit))
    const { status, body } = await host.json(SKILL_HISTORY_ROUTES.skills)
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: false, code: 'curator-not-mounted' })
  })
})

describe('skill-history routes: the read/write surface', () => {
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
    const host = await mountHostRoutes(ctx, audit => makeSkillHistoryRoutes({ getCurator: () => ctx.evolutionCurator }, audit))
    // Health: the probe the client uses before it claims a route family exists.
    const health = await host.json(SKILL_HISTORY_ROUTES.health)
    expect(health.status).toBe(200)
    expect(health.body).toEqual({ ok: true, data: { surface: 'skill-history' } })
    // Skills: only the tree entries that actually recorded a version.
    const skills = await host.json<{
      ok: boolean
      data: Array<{
        name: string
        versions: number
        description: string
        managed: boolean
        protectedBy: string | null
        protectionUnknown: boolean
        lastAt: string | null
        age: { unit: string; n: number } | null
      }>
    }>(SKILL_HISTORY_ROUTES.skills)
    expect(skills.status).toBe(200)
    // The row carries what the listing already knew, so the left column can say what a skill IS.
    expect(skills.body.data).toHaveLength(1)
    expect(skills.body.data[0]?.name).toBe('panel-skill')
    expect(skills.body.data[0]?.versions).toBe(3)
    expect(skills.body.data[0]?.description).toContain('fixture')
    expect(typeof skills.body.data[0]?.managed).toBe('boolean')
    expect(skills.body.data[0]?.protectionUnknown).toBe(false)
    // "Last changed" rides the same row and comes from the index this route already read: the
    // newest entry across BOTH chains, with its age bucket (the words stay in the dictionary).
    expect(typeof skills.body.data[0]?.lastAt).toBe('string')
    expect(typeof skills.body.data[0]?.age?.unit).toBe('string')
    // Versions: the body chain and the support-file chain come back apart, and every row carries
    // the verdicts and the vocabulary key the panel renders (it owns no rule of its own).
    const versions = await host.json<{
      ok: boolean
      data: {
        content: Array<{
          action: string
          actionKind: string
          age: { unit: string; n: number }
          undoable: boolean
          charsDelta?: number
          cells: { title: Array<{ key: string; slot: string }>; meta: Array<{ key: string; literal?: string }> }
        }>
        support: Array<{ action: string; actionKind: string; path?: string }>
        liveHash: string | null
      }
    }>(SKILL_HISTORY_ROUTES.versions + '?name=panel-skill')
    expect(versions.status).toBe(200)
    expect(versions.body.data.content.map(entry => entry.action)).toEqual(['create', 'update'])
    expect(versions.body.data.content.map(entry => entry.actionKind)).toEqual(['create', 'update'])
    expect(versions.body.data.support.map(entry => entry.action)).toEqual(['write_file'])
    expect(versions.body.data.support.map(entry => entry.actionKind)).toEqual(['support-write'])
    // A support row NAMES ITS FILE: the recorded path travels with the bytes, so the panel can say
    // which file a version belongs to instead of the generic word (legacy rows have none).
    expect(versions.body.data.support.map(entry => entry.path)).toEqual(['references/notes.md'])
    expect(typeof versions.body.data.content[0]?.age.unit).toBe('string')
    // What each row SAYS and where each fact sits is decided in core and travels with the row, so the
    // browser half renders cells instead of assembling a sentence (W1/W15).
    // U-5/G4.2: the recorded hash is on screen now (a short code, hover = the whole value).
    expect(versions.body.data.content[0]?.cells.title.map(cell => cell.key)).toEqual(['v', 'action', 'time', 'hash'])
    expect(versions.body.data.content[0]?.cells.title.map(cell => cell.slot)).toEqual(['meta', 'lead', 'meta', 'meta'])
    // A size change is its own cell exactly when the row HAS a non-zero one, so the rule holds for
    // every row rather than for the fixture's two versions (which happen to be the same length).
    for (const row of versions.body.data.content) {
      expect(row.cells.title.some(cell => cell.key === 'delta')).toBe(row.charsDelta !== undefined && row.charsDelta !== 0)
    }
    // The live content is the newest body version, so exactly that row is not undoable.
    expect(versions.body.data.content.filter(entry => !entry.undoable)).toHaveLength(1)
    // The diff route: one version against its predecessor, as facts plus the changed region.
    const diff = await host.json<{
      ok: boolean
      data: {
        v: number
        against: number | null
        hunks: Array<{ path: string; oldText: string; newText: string }>
        truncated: boolean
      }
    }>(SKILL_HISTORY_ROUTES.diff + '?name=panel-skill&v=2')
    expect(diff.status).toBe(200)
    expect(diff.body.data.v).toBe(2)
    expect(diff.body.data.against).toBe(1)
    expect(diff.body.data.hunks[0]?.path).toBe('SKILL.md')
    expect(diff.body.data.hunks[0]?.oldText).not.toBe(diff.body.data.hunks[0]?.newText)
    // Refusals stay refusals: a version that is not in the history, and a malformed query.
    expect((await host.json(SKILL_HISTORY_ROUTES.diff + '?name=panel-skill&v=99')).status).toBe(404)
    expect((await host.json(SKILL_HISTORY_ROUTES.diff + '?name=panel-skill&v=x')).status).toBe(400)
    expect((await host.json(SKILL_HISTORY_ROUTES.diff)).status).toBe(400)
    // The body route: what one version SAYS, bounded, with the same 400/404 posture.
    const whole = await host.json<{ ok: boolean; data: { v: number; display: string; chars: number; truncated: boolean } }>(SKILL_HISTORY_ROUTES.body + '?name=panel-skill&v=2')
    expect(whole.status).toBe(200)
    expect(whole.body.data.v).toBe(2)
    expect(whole.body.data.display).toContain('Two.')
    // W19: the frontmatter block is metadata the row already carries, and the platform renderer reads
    // its closing fence as a setext underline, so the document a reader opens starts at its body.
    expect(whole.body.data.display.startsWith('---')).toBe(false)
    expect(whole.body.data.display).not.toContain('description:')
    expect(whole.body.data.truncated).toBe(false)
    expect((await host.json(SKILL_HISTORY_ROUTES.body + '?name=panel-skill&v=99')).status).toBe(404)
    expect((await host.json(SKILL_HISTORY_ROUTES.body + '?name=panel-skill&v=x')).status).toBe(400)
    expect((await host.json(SKILL_HISTORY_ROUTES.body)).status).toBe(400)
    // A support version is refused with the curator's own sentence, not a frontmatter error.
    const refused = await host.json<{ ok: boolean; code: string; message: string }>(SKILL_HISTORY_ROUTES.undo, { method: 'POST', body: { name: 'panel-skill', v: 3 } })
    expect(refused.status).toBe(200)
    expect(refused.body.ok).toBe(false)
    expect(refused.body.code).toBe('undo-refused')
    expect(refused.body.message).toContain('存的是支撑文件的字节')
    // The undo itself: an empty body means "the state before the last body change".
    const undone = await host.json<{ ok: boolean; data: { message: string } }>(SKILL_HISTORY_ROUTES.undo, { method: 'POST', body: { name: 'panel-skill' } })
    expect(undone.status).toBe(200)
    expect(undone.body.ok).toBe(true)
    expect(undone.body.data.message).toContain('已撤销到 v1')
    expect(await library.read('panel-skill')).toContain('One.')
    // Transport refusals: an undeclared method falls through on the platform carrier (the exact route
    // owns GET only), while a missing name / bad body / malformed version stay the family's 400s.
    // No route may answer with the retired {error} envelope: the client parses {ok:false,code,message}.
    const routesSource = readFileSync(fileURLToPath(new URL('../src/routes.ts', import.meta.url)), 'utf8')
    expect(routesSource).not.toContain('{ error:')
    expect((await host.json(SKILL_HISTORY_ROUTES.versions, { method: 'POST' })).status).toBe(404)
    expect((await host.json(SKILL_HISTORY_ROUTES.versions)).status).toBe(400)
    const badBody = await host.json(SKILL_HISTORY_ROUTES.undo, { method: 'POST', body: 'not json' })
    expect(badBody.status).toBe(400)
    const badVersion = await host.json(SKILL_HISTORY_ROUTES.undo, { method: 'POST', body: { name: 'panel-skill', v: 0 } })
    expect(badVersion.status).toBe(400)
    expect((await host.json('/api/dsh-evolution/skill-history/unknown')).status).toBe(404)
    // The body bound is a real limit, not a comment.
    const oversized = await host.json(SKILL_HISTORY_ROUTES.undo, { method: 'POST', body: 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1) })
    expect(oversized.status).toBe(400)
  })
})
