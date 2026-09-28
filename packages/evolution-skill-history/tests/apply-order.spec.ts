/**
 * Mounting order: the sidebar panel renders as soon as the browser half loads, so the HOST half must
 * still register its routes when the web server arrives AFTER this row applies. 0.11.1 read
 * `ctx.get('webServer')` once at apply time and returned early when it was undefined, which left the
 * routes unregistered while the panel answered HTTP 404 (found on the installed artifact, not in CI).
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as SkillHistory from '../src/index.ts'
import { SKILL_HISTORY_ROUTES } from '../src/routes.ts'

/** A web server stand-in that records every registered path, and what its disposers release. */
function fakeWebServer(): { paths: string[]; released: string[]; register: (route: { path: string }) => () => void } {
  const paths: string[] = []
  const released: string[] = []
  return {
    paths,
    released,
    register(route: { path: string }): () => void {
      paths.push(route.path)
      return () => { released.push(route.path) }
    },
  }
}

describe('skill-history host half: mounting order', () => {
  it('registers every route when the web server mounts AFTER the row applies', async () => {
    const ctx = new Context()
    const server = fakeWebServer()
    await ctx.plugin(SkillHistory)
    expect(server.paths).toEqual([])
    ctx.provide('webServer', server as never)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect([...server.paths].sort()).toEqual([
      SKILL_HISTORY_ROUTES.body,
      SKILL_HISTORY_ROUTES.diff,
      SKILL_HISTORY_ROUTES.health,
      SKILL_HISTORY_ROUTES.skills,
      SKILL_HISTORY_ROUTES.undo,
      SKILL_HISTORY_ROUTES.versions,
    ].sort())
  })

  it('releases every route when the plugin is disposed (HMR safety)', async () => {
    const ctx = new Context()
    const server = fakeWebServer()
    const fiber = await ctx.plugin(SkillHistory)
    ctx.provide('webServer', server as never)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(server.paths).toHaveLength(6)
    expect(server.released).toEqual([])
    await fiber.dispose()
    expect([...server.released].sort()).toEqual([...server.paths].sort())
  })

  it('stays inert — and does not throw — when no web server ever arrives', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillHistory)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(ctx.get('webServer')).toBeUndefined()
  })
})
