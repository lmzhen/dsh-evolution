// @tier pre-tag
/**
 * Mounting order on the platform carrier: the sidebar panel renders as soon as the browser half loads,
 * so the HOST half must still register its routes when the `connection` service arrives AFTER this
 * row applies. registerHostRoutes waits on it via ctx.inject — a profile that never gets a connection
 * stays inert (hostSurface reports E-325), never pending and never throwing.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as SkillHistory from '../src/index.ts'
import { SKILL_HISTORY_ROUTES } from '../src/routes.ts'
import { provideHostConnection } from '../../test-support/host-route-harness.ts'

const expected = (): string[] => [
  SKILL_HISTORY_ROUTES.body,
  SKILL_HISTORY_ROUTES.diff,
  SKILL_HISTORY_ROUTES.health,
  SKILL_HISTORY_ROUTES.skills,
  SKILL_HISTORY_ROUTES.undo,
  SKILL_HISTORY_ROUTES.versions,
].sort()

describe('skill-history host half: mounting order', () => {
  it('registers every route when the connection service mounts AFTER the row applies', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillHistory)
    const before = ctx.get('connection') as unknown
    expect(before).toBeUndefined()
    const host = provideHostConnection(ctx)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect([...host.paths].sort()).toEqual(expected())
  })

  it('releases every route when the plugin is disposed (HMR safety)', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(SkillHistory)
    const host = provideHostConnection(ctx)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(host.paths).toHaveLength(6)
    expect(host.released).toEqual([])
    await fiber.dispose()
    expect([...host.released].sort()).toEqual([...host.paths].sort())
    // `paths` is the registration HISTORY; `routes` is the live registry.
    expect(host.routes).toHaveLength(0)
  })

  it('stays inert — and does not throw — when no connection ever arrives', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillHistory)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(ctx.get('connection')).toBeUndefined()
  })
})
