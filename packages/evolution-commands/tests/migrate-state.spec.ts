// @tier fast
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { mountStateStack } from '../../test-support/state-stack.ts'
import { tempRoot } from '../../test-support/temp-home.ts'
import { runMigrateStateCommand } from '../src/host-commands/migrate-state.ts'
import { activatePendingStateV2 } from '@deepseek-ai/dsh-evolution-core/state/migrate'
import { STATE_V2_MIGRATION_MARKER, STATE_V2_PENDING_MARKER } from '@deepseek-ai/dsh-evolution-core/state/storage'

const seeded = async (): Promise<{ ctx: Awaited<ReturnType<typeof mountStateStack>>; home: string }> => {
  const home = await tempRoot('dsh-cmd-migrate-')
  const ctx = await mountStateStack(home, { evolution: true })
  const domain = ctx.evolutionStateStorage.provider('domain')
  await domain.savePending({
    id: 'p1', kind: 'memory', summary: 'm', args: {}, createdAt: '2026-01-01T00:00:00.000Z', status: 'pending',
  })
  return { ctx, home }
}

const command = (overrides: { dryRun?: boolean; positionals?: string[] } = {}) => ({
  input: 'migrate state',
  command: {
    flags: new Map<string, string | boolean>(overrides.dryRun === true ? [['dry-run', true]] : []),
    positionals: overrides.positionals ?? [],
  },
  locale: 'en' as const,
})

describe('/evolution migrate state', () => {
  it('stages migration with --to v2 and activates only on the next start', async () => {
    const { ctx, home } = await seeded()
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const result = await runMigrateStateCommand({ ...command(), command: { flags: new Map<string, string | boolean>([['to', 'v2']]), positionals: [] }, ctx })
      expect(result).toMatchObject({ kind: 'success' })
      expect(result.text).toContain('Staged')
      const io = ctx.evolutionIo.provider()
      const evolution = join(home, 'evolution')
      expect(await io.exists(join(evolution, 'store-v2', 'head.json'))).toBe(false)
      expect(await io.exists(join(evolution, 'state', STATE_V2_MIGRATION_MARKER))).toBe(false)
      expect(await io.exists(join(evolution, 'state', STATE_V2_PENDING_MARKER))).toBe(true)
      // A restart promotes from the CURRENT legacy bytes; the staged head is
      // deliberately absent until then.
      await activatePendingStateV2(ctx, { io, home: evolution })
      expect(await io.exists(join(evolution, 'store-v2', 'head.json'))).toBe(true)
      expect(await io.exists(join(evolution, 'state', STATE_V2_MIGRATION_MARKER))).toBe(true)
      expect(await io.exists(join(evolution, 'state', STATE_V2_PENDING_MARKER))).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('reverts to a legacy activation record without deleting the v2 head', async () => {
    const { ctx, home } = await seeded()
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      await runMigrateStateCommand({ ...command(), command: { flags: new Map<string, string | boolean>([['to', 'v2']]), positionals: [] }, ctx })
      const io = ctx.evolutionIo.provider()
      const evolution = join(home, 'evolution')
      await activatePendingStateV2(ctx, { io, home: evolution })
      const result = await runMigrateStateCommand({ ...command(), command: { flags: new Map<string, string | boolean>([['revert', true]]), positionals: [] }, ctx })
      expect(result, result.text).toMatchObject({ kind: 'success' })
      expect(result.text).toContain('Rolled back')
      const record = JSON.parse(await io.readText(join(evolution, 'state', STATE_V2_MIGRATION_MARKER)) ?? '{}') as { mode?: string; generation?: number }
      expect(record.mode).toBe('legacy')
      expect(record.generation).toBeGreaterThan(0)
      expect(await io.exists(join(evolution, 'store-v2', 'head.json'))).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('re-stages after a rollback and archives the old v2 store', async () => {
    const { ctx, home } = await seeded()
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const evolution = join(home, 'evolution')
      const io = ctx.evolutionIo.provider()
      await runMigrateStateCommand({ ...command(), command: { flags: new Map<string, string | boolean>([['to', 'v2']]), positionals: [] }, ctx })
      await activatePendingStateV2(ctx, { io, home: evolution })
      await runMigrateStateCommand({ ...command(), command: { flags: new Map<string, string | boolean>([['revert', true]]), positionals: [] }, ctx })
      const staged = await runMigrateStateCommand({ ...command(), command: { flags: new Map<string, string | boolean>([['to', 'v2']]), positionals: [] }, ctx })
      expect(staged, staged.text).toMatchObject({ kind: 'success' })
      await activatePendingStateV2(ctx, { io, home: evolution })
      expect(await io.exists(join(evolution, 'store-v2', 'head.json'))).toBe(true)
      const record = JSON.parse(await io.readText(join(evolution, 'state', STATE_V2_MIGRATION_MARKER)) ?? '{}') as { mode?: string }
      expect(record.mode).toBe('store-v2')
      const rollbackDirs = await io.list(evolution)
      expect(rollbackDirs.some(name => name.startsWith('store-v2-rollback-'))).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('rejects an unknown --to target instead of silently using v1', async () => {
    const { ctx } = await seeded()
    const result = await runMigrateStateCommand({ ...command(), command: { flags: new Map<string, string | boolean>([['to', 'v9']]), positionals: [] }, ctx })
    expect(result.kind).toBe('error')
    expect(result.text).toContain('migrate state')
  })

  it('writes the store and reports the counts', async () => {
    const { ctx, home } = await seeded()
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const result = await runMigrateStateCommand({ ...command(), ctx })
      expect(result).toMatchObject({ kind: 'success' })
      expect(result.text).toContain('Migrated')
      expect(result.text).toContain(join(home, 'evolution', 'state', 'store.json'))
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('dry-run reports without writing', async () => {
    const { ctx, home } = await seeded()
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const result = await runMigrateStateCommand({ ...command({ dryRun: true }), ctx })
      expect(result.kind).toBe('success')
      expect(result.text).toContain('dry-run')
      expect(await ctx.evolutionIo.provider().exists(join(home, 'evolution', 'state', 'store.json'))).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('accepts the parser positional form `state`', async () => {
    const { ctx, home } = await seeded()
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const result = await runMigrateStateCommand({ ...command({ dryRun: true, positionals: ['state'] }), ctx })
      expect(result.kind).toBe('success')
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('rejects a third positional instead of silently ignoring it', async () => {
    const { ctx } = await seeded()
    const result = await runMigrateStateCommand({ ...command({ positionals: ['extra'] }), ctx })
    expect(result.kind).toBe('error')
    expect(result.text).toContain('migrate state')
  })
})
