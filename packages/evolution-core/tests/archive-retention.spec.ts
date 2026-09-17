/**
 * 0.5.0 V1 (design §16.6-④): the archive retention window REPORTS by default.
 * Upstream's hard invariant is never to delete an archived skill, and §14 rules
 * out automatic deletion here too — so the deletion only happens under an
 * explicit `prune` policy, and the read half (`expiredArchives`) is what the
 * curator's run report carries.
 */
import { expect, it } from 'vitest'
import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SKILL_LIMITS, nodeEvolutionIo, SkillLibrary } from '@deepseek-ai/dsh-evolution-core'

const body = (name: string) => `---
name: ${name}
description: ${name} body
---

Body of ${name}.
`

async function seed(limits = DEFAULT_SKILL_LIMITS): Promise<{ root: string; lib: SkillLibrary }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-retention-'))
  const lib = new SkillLibrary(root, nodeEvolutionIo(), limits)
  await lib.create('umbrella', body('umbrella'), 'foreground')
  await lib.create('old-skill', body('old-skill'), 'foreground')
  const archived = await lib.archive('old-skill', { absorbedInto: 'umbrella' })
  expect(archived.ok, archived.message).toBe(true)
  // Backdate the archived entry past the 365-day window.
  const past = new Date(Date.now() - 400 * 86_400_000)
  await utimes(join(root, '.archive', 'old-skill'), past, past)
  return { root, lib }
}

it('V1: the default policy reports expired archives and deletes nothing', async () => {
  const { root, lib } = await seed()
  expect(lib.archiveRetentionPolicy()).toBe('report')
  expect(await lib.expiredArchives()).toEqual(['old-skill'])
  await lib.snapshotAll('retention-report')
  expect(await readdir(join(root, '.archive'))).toContain('old-skill')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

it('V1: an explicit prune policy still deletes past the window', async () => {
  const { root } = await seed()
  const pruning = new SkillLibrary(root, nodeEvolutionIo(), { ...DEFAULT_SKILL_LIMITS, archiveRetention: 'prune' })
  expect(pruning.archiveRetentionPolicy()).toBe('prune')
  await pruning.snapshotAll('retention-prune')
  expect(await readdir(join(root, '.archive'))).not.toContain('old-skill')
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})
