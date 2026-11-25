// @tier fast
import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeEvolutionIo } from '../../src/io.ts'
import { guardLegacyActivation, StoreActivationPendingError } from '../../src/store/activation-guard.ts'
import { STATE_V2_MIGRATION_MARKER } from '../../src/state/constants.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'

describe('legacy activation guard', () => {
  it('refuses a write after the v2 medium appears, while reads stay readable', async () => {
    const root = await tempRoot('dsh-activation-guard-')
    const io = nodeEvolutionIo()
    const target = join(root, 'runs.json')
    const other = join(root, 'skills', 'SKILL.md')
    await mkdir(join(root, 'state'), { recursive: true })
    const guarded = guardLegacyActivation(io, root, { path: path => path === target })
    await guarded.writeText(target, '{"runs":1}\n')
    await guarded.writeText(other, 'tree\n')
    await writeFile(join(root, 'state', STATE_V2_MIGRATION_MARKER), '{}\n')
    await expect(guarded.writeText(target, '{"runs":2}\n')).rejects.toBeInstanceOf(StoreActivationPendingError)
    expect(await guarded.readText(target)).toBe('{"runs":1}\n')
    // Non-migrated paths (skill tree) stay writable in the same process.
    await guarded.writeText(other, 'tree-2\n')
    expect(await guarded.readText(other)).toBe('tree-2\n')
  })
})
