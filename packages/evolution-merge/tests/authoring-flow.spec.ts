// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { readCommitReceipt, runAuthoring, writeStagedFile, type CommitPort, type SkillCard } from '../src/index.ts'

const BODY = (name: string) => ['---', 'name: ' + name, 'description: fixture', '---', '', '# ' + name, ''].join('\n')
const cards: SkillCard[] = [{ name: 'alpha-skill', description: 'a', body: BODY('alpha-skill') }, { name: 'beta-skill', description: 'b', body: BODY('beta-skill') }]

function port(): CommitPort {
  return {
    async readSkill(name) { return cards.find(card => card.name === name)?.body ?? null },
    async commitMerge(plan) { return { ok: true, message: 'merged', unitId: 'u-1', archived: plan.sources, mutations: 3 } },
  }
}

it('authors a staged tree, passes the gate and commits', async () => {
  const home = await tempRoot('dsh-merge-authoring-')
  const io = nodeEvolutionIo()
  const result = await runAuthoring({
    io, home, runId: 'run-1', target: 'umbrella', cards, commitPort: port(), now: () => 200, summary: 'merge',
    async author(staging) {
      expect(await writeStagedFile(io, staging.home, staging.runId, 'SKILL.md', BODY('umbrella'))).toMatchObject({ ok: true })
      return 'written'
    },
  })
  expect(result.ok, result.ok ? '' : result.message).toBe(true)
  if (!result.ok) return
  expect(result.tree.target).toBe('umbrella')
  expect(result.commit.ok).toBe(true)
  expect(await readCommitReceipt(io, home, 'run-1')).toMatchObject({ unitId: 'u-1', target: 'umbrella' })
})

it('refuses when the author fails or leaves a blocking tree', async () => {
  const home = await tempRoot('dsh-merge-authoring-fail-')
  const io = nodeEvolutionIo()
  const failed = await runAuthoring({
    io, home, runId: 'run-1', target: 'umbrella', cards, commitPort: port(), now: () => 200, summary: 'merge',
    async author() { throw new Error('boom') },
  })
  expect(failed.ok).toBe(false)

  const blocking = await runAuthoring({
    io, home, runId: 'run-2', target: 'umbrella', cards, commitPort: port(), now: () => 200, summary: 'merge',
    async author(staging) { await writeStagedFile(io, staging.home, staging.runId, 'SKILL.md', 'no frontmatter') },
  })
  expect(blocking.ok).toBe(false)
  if (blocking.ok) return
  expect(blocking.findings?.some(finding => finding.rule === 'frontmatter')).toBe(true)
})
it('refuses a pinned target before authoring', async () => {
  const home = await tempRoot('dsh-merge-authoring-pinned-')
  const io = nodeEvolutionIo()
  const pinned: SkillCard[] = [{ ...cards[0]!, protectedBy: 'pinned' }]
  const result = await runAuthoring({
    io, home, runId: 'run-1', target: 'alpha-skill', cards: pinned, commitPort: port(), now: () => 200, summary: 'merge',
    async author() { throw new Error('must not author') },
  })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.message).toContain('pinned')
})
