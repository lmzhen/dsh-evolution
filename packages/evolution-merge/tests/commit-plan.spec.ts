// @tier pre-tag
import { expect, it } from 'vitest'
import { buildCommitPlan, resolveTargetName, rewriteFrontmatterName } from '../src/index.ts'

const BODY = (name: string, extra = '') => ['---', 'name: ' + name, 'description: merge fixture', '---', '', '# ' + name, '', extra, ''].join('\n')

it('resolves a free target and never truncates a long name', () => {
  expect(resolveTargetName('umbrella', () => false)).toEqual({ ok: true, name: 'umbrella', suffix: 1 })
  expect(resolveTargetName('umbrella', name => name === 'umbrella' || name === 'umbrella-v2')).toEqual({ ok: true, name: 'umbrella-v3', suffix: 3 })
  expect(resolveTargetName('x'.repeat(64), () => true).ok).toBe(false)
  expect(resolveTargetName('x'.repeat(65), () => false).ok).toBe(false)
})

it('rewrites only the frontmatter name', () => {
  const body = BODY('old-name', 'body text')
  const rewritten = rewriteFrontmatterName(body, 'new-name')
  expect(rewritten).toContain('name: new-name')
  expect(rewritten).not.toContain('name: old-name')
  expect(rewritten).toContain('body text')
  expect(rewriteFrontmatterName('no frontmatter', 'x')).toBe('no frontmatter')
})

it('assembles a commit plan and preserves source expectations', () => {
  const result = buildCommitPlan({
    target: 'umbrella',
    create: false,
    mergedBody: BODY('old-name', 'See references/a.md'),
    mergedFiles: [{ path: 'references/a.md', content: 'a' }],
    targetCurrent: BODY('umbrella'),
    sourceBodies: [{ name: 'src', body: BODY('src') }],
    origin: 'foreground',
    summary: 'merge src',
  })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.plan).toMatchObject({
    target: 'umbrella', targetExists: true, sources: ['src'],
    expectedTargetBody: BODY('umbrella'), expectedSourceBodies: [{ name: 'src', body: BODY('src') }],
    summary: 'merge src', origin: 'foreground',
  })
  expect(result.plan.body).toContain('name: umbrella')
  expect(result.plan.supportFiles).toEqual([{ path: 'references/a.md', content: 'a' }])
})

it('refuses create/target disagreement and empty sources', () => {
  expect(buildCommitPlan({
    target: 'x', create: true, mergedBody: BODY('x'), mergedFiles: [], targetCurrent: BODY('x'),
    sourceBodies: [{ name: 's', body: BODY('s') }], origin: 'foreground', summary: 'x',
  })).toMatchObject({ ok: false })
  expect(buildCommitPlan({
    target: 'x', create: false, mergedBody: BODY('x'), mergedFiles: [], targetCurrent: BODY('x'),
    sourceBodies: [], origin: 'foreground', summary: 'x',
  })).toMatchObject({ ok: false })
})
it('drops the target itself from sources', () => {
  const result = buildCommitPlan({ target: 'alpha', create: false, mergedBody: BODY('alpha'), mergedFiles: [], targetCurrent: BODY('alpha'), sourceBodies: [{ name: 'alpha', body: BODY('alpha') }, { name: 'beta', body: BODY('beta') }], origin: 'foreground', summary: 'x' })
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.plan.sources).toEqual(['beta'])
})
