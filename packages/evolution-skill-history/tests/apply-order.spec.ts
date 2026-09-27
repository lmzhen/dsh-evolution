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

/** A web server stand-in that records every registered path. */
function fakeWebServer(): { paths: string[]; register: (route: { path: string }) => () => void } {
  const paths: string[] = []
  return {
    paths,
    register(route: { path: string }): () => void {
      paths.push(route.path)
      return () => {}
    },
  }
}

describe('skill-history host half: mounting order', () => {
  it('registers the four routes when the web server mounts AFTER the row applies', async () => {
    const ctx = new Context()
    const server = fakeWebServer()
    await ctx.plugin(SkillHistory)
    expect(server.paths).toEqual([])
    ctx.provide('webServer', server as never)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect([...server.paths].sort()).toEqual([
      SKILL_HISTORY_ROUTES.health,
      SKILL_HISTORY_ROUTES.skills,
      SKILL_HISTORY_ROUTES.undo,
      SKILL_HISTORY_ROUTES.versions,
    ].sort())
  })

  it('stays inert — and does not throw — when no web server ever arrives', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillHistory)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(ctx.get('webServer')).toBeUndefined()
  })
})
