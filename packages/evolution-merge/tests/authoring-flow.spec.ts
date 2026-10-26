// @tier pre-tag
import { expect, it } from 'vitest'
import { DEFAULT_SKILL_LIMITS, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { readCommitReceipt, runAuthoring, writeStagedFile, type CommitPort, type SkillCard } from '../src/index.ts'

const BODY = (name: string) => ['---', 'name: ' + name, 'description: fixture', '---', '', '# ' + name, ''].join('\n')
const cards: SkillCard[] = [{ name: 'alpha-skill', description: 'a', body: BODY('alpha-skill'), managed: true }, { name: 'beta-skill', description: 'b', body: BODY('beta-skill'), managed: true }]

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

it('fails closed on a target with a separator before authoring', async () => {
  const home = await tempRoot('dsh-merge-authoring-target-')
  const io = nodeEvolutionIo()
  const result = await runAuthoring({ io, home, runId: 'run-target', target: 'bad/target', cards, commitPort: port(), now: () => 200, summary: 'merge', async author() { throw new Error('must not author') } })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.code).toBe('target-invalid')
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
it('uses one limits snapshot at the gate and never commits an over-limit tree', async () => {
  const home = await tempRoot('dsh-merge-authoring-limits-')
  const io = nodeEvolutionIo()
  let commits = 0
  const commitPort: CommitPort = { readSkill: port().readSkill, async commitMerge(plan) { commits += 1; return { ok: true, message: 'merged', unitId: 'u-limit', archived: plan.sources, mutations: 1 } } }
  const result = await runAuthoring({
    io, home, runId: 'run-limit', target: 'umbrella', cards, commitPort, now: () => 200, summary: 'merge',
    limits: { ...DEFAULT_SKILL_LIMITS, maxSkillFileBytes: 8 },
    async author(staging) { await writeStagedFile(io, staging.home, staging.runId, 'SKILL.md', BODY('umbrella')) },
  })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.findings?.some(finding => finding.rule === 'limit' && finding.severity === 'block')).toBe(true)
  expect(commits).toBe(0)
  expect(await readCommitReceipt(io, home, 'run-limit')).toBeNull()
})

it('allows the exact limit and rejects one byte over at both gate and commit', async () => {
  const body = BODY('umbrella')
  const exact = Buffer.byteLength(body, 'utf8')
  for (const [runId, limit, ok] of [['run-exact', exact, true], ['run-over', exact - 1, false]] as const) {
    const home = await tempRoot('dsh-merge-authoring-boundary-')
    const io = nodeEvolutionIo()
    let commits = 0
    const commitPort: CommitPort = { readSkill: port().readSkill, async commitMerge(plan) { commits += 1; return { ok: true, message: 'merged', unitId: 'u-' + runId, archived: plan.sources, mutations: 1 } } }
    const result = await runAuthoring({ io, home, runId, target: 'umbrella', cards, commitPort, now: () => 200, summary: 'merge', limits: { ...DEFAULT_SKILL_LIMITS, maxSkillFileBytes: limit }, async author(staging) { await writeStagedFile(io, staging.home, staging.runId, 'SKILL.md', body) } })
    expect(result.ok, runId).toBe(ok)
    expect(commits).toBe(ok ? 1 : 0)
  }
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
it('archives only the non-target source when merging into an existing target', async () => {
  const home = await tempRoot('dsh-merge-authoring-archive-')
  const io = nodeEvolutionIo()
  const result = await runAuthoring({
    io, home, runId: 'run-1', target: 'alpha-skill', cards, commitPort: port(), now: () => 200, summary: 'merge',
    async author(staging) { await writeStagedFile(io, staging.home, staging.runId, 'SKILL.md', BODY('alpha-skill')) },
  })
  expect(result.ok, result.ok ? '' : result.message).toBe(true)
  if (result.ok) expect(result.commit.ok && result.commit.result.archived).toEqual(['beta-skill'])
})

it('refuses a non-managed or curator-blocked target before authoring', async () => {
  const home = await tempRoot('dsh-merge-authoring-target-guard-')
  const io = nodeEvolutionIo()
  const unmanaged: SkillCard[] = [{ ...cards[0]!, managed: false }]
  const first = await runAuthoring({ io, home, runId: 'run-1', target: 'alpha-skill', cards: unmanaged, commitPort: port(), now: () => 200, summary: 'merge', async author() { throw new Error('must not author') } })
  expect(first.ok).toBe(false)
  if (!first.ok) expect(first.message).toContain('family-managed')
  const second = await runAuthoring({ io, home, runId: 'run-2', target: 'alpha-skill', cards, isBlocked: name => name === 'alpha-skill', commitPort: port(), now: () => 200, summary: 'merge', async author() { throw new Error('must not author') } })
  expect(second.ok).toBe(false)
  if (!second.ok) expect(second.message).toContain('blocked')
})

it('refuses when curator blocks the target during authoring', async () => {
  const home = await tempRoot('dsh-merge-authoring-blocked-during-')
  const io = nodeEvolutionIo()
  let blocked = false
  let commits = 0
  const guarded: CommitPort = { ...port(), async commitMerge(plan) { commits += 1; return await port().commitMerge(plan) } }
  const result = await runAuthoring({
    io, home, runId: 'run-1', target: 'umbrella', cards, commitPort: guarded, now: () => 200, summary: 'merge',
    isBlocked: () => blocked,
    async author(staging) { await writeStagedFile(io, staging.home, staging.runId, 'SKILL.md', BODY('umbrella')); blocked = true },
  })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.message).toContain('blocked')
  expect(commits).toBe(0)
})
