// @tier pre-tag
// E2 (FR-EXEC-12 / GAP-CAND-02): commitMerge re-checks the decision-time anchors against
// the LIVE tree (body + support) and refuses with a typed code before writing anything.
import { expect, it } from 'vitest'
import { SkillLibrary, revisionSupportDigest } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

const BODY = (name: string): string => '---\nname: ' + name + '\ndescription: A merge revision fixture.\n---\n\n# ' + name + '\n'

async function fixture(): Promise<{ lib: SkillLibrary; plan: Awaited<ReturnType<typeof planned>> }> {
  const root = await tempRoot('dsh-commit-revision-')
  const lib = new SkillLibrary(root)
  await lib.create('target-skill', BODY('target-skill'), 'subagent')
  await lib.create('src-a', BODY('src-a'), 'foreground')
  await lib.writeSupportFile('target-skill', 'references/t.md', '# t\n', 'subagent')
  await lib.writeSupportFile('src-a', 'references/a.md', '# a\n', 'foreground')
  return { lib, plan: await planned(lib) }
}

async function planned(lib: SkillLibrary) {
  const targetBody = (await lib.read('target-skill')) ?? ''
  const sourceBody = (await lib.read('src-a')) ?? ''
  const targetFingerprint = (await lib.revisionFingerprint('target-skill')) ?? ''
  const sourceFingerprint = (await lib.revisionFingerprint('src-a')) ?? ''
  return {
    target: 'target-skill',
    targetExists: true,
    sources: ['src-a'],
    body: BODY('target-skill') + '## Merged\n',
    supportFiles: [],
    expectedTargetBody: targetBody,
    expectedSourceBodies: [{ name: 'src-a', body: sourceBody }],
    targetRevision: await lib.revisionAnchor('target-skill'),
    sourceRevisions: { 'src-a': await lib.revisionAnchor('src-a') },
    supportDigest: revisionSupportDigest([targetFingerprint, sourceFingerprint]),
    origin: 'foreground' as const,
    summary: 'revision cas',
  }
}

it('commits when every decision anchor still matches the live tree', async () => {
  const { lib, plan } = await fixture()
  const result = await lib.commitMerge(plan)
  expect(result).toMatchObject({ ok: true })
  expect(await lib.read('src-a')).toBeNull()
})

it('refuses a changed target support file with code target-changed and writes nothing', async () => {
  const { lib, plan } = await fixture()
  const before = await lib.read('target-skill')
  await lib.writeSupportFile('target-skill', 'references/t.md', '# changed\n', 'subagent')
  const result = await lib.commitMerge(plan)
  expect(result).toMatchObject({ ok: false, code: 'target-changed' })
  expect(await lib.read('target-skill')).toBe(before)
  expect(await lib.read('src-a')).not.toBeNull()
  expect(before).toContain('# target-skill')
})

it('refuses a changed source support file with code source-changed and writes nothing', async () => {
  const { lib, plan } = await fixture()
  await lib.writeSupportFile('src-a', 'references/a.md', '# changed\n', 'foreground')
  const result = await lib.commitMerge(plan)
  expect(result).toMatchObject({ ok: false, code: 'source-changed' })
  expect(await lib.read('src-a')).not.toBeNull()
  expect(await lib.read('target-skill')).toBe(plan.expectedTargetBody)
})

it('refuses a mismatched support digest with code support-changed', async () => {
  const { lib, plan } = await fixture()
  const result = await lib.commitMerge({ ...plan, supportDigest: revisionSupportDigest(['stale']) })
  expect(result).toMatchObject({ ok: false, code: 'support-changed' })
  expect(await lib.read('src-a')).not.toBeNull()
})
