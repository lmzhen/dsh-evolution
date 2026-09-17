/**
 * 0.5.0 V1 (design §16.7): the re-home plan a refused consolidation reports.
 * Pure planning — the refusal still stands, so these cases assert the NUMBERS a
 * later `apply` batch will have to honour: identity moves need no rewrite, a
 * collision forces a rename (and exactly one edit), and a cited file with no
 * destination is named instead of being silently dropped.
 */
import { describe, expect, it } from 'vitest'
import { describeReferenceRewrite, planReferenceRewrite, planRehoming } from '@deepseek-ai/dsh-evolution-core'

describe('planRehoming (design §16.7)', () => {
  it('keeps paths that are free and prefixes only what collides', () => {
    const first = planRehoming(['references/guide.md', 'templates/t.tmpl'], ['references/other.md'], 'narrow')
    expect(first.moves).toEqual([
      { from: 'references/guide.md', to: 'references/guide.md' },
      { from: 'templates/t.tmpl', to: 'templates/t.tmpl' },
    ])
    expect(first.collisions).toEqual([])

    const collided = planRehoming(['references/guide.md'], ['references/guide.md'], 'narrow')
    expect(collided.moves).toEqual([{ from: 'references/guide.md', to: 'references/narrow-guide.md' }])
    expect(collided.collisions).toEqual(['references/guide.md'])
  })

  it('disambiguates a second collision instead of overwriting the first rename', () => {
    const plan = planRehoming(['references/guide.md'], ['references/guide.md', 'references/narrow-guide.md'], 'narrow')
    expect(plan.moves).toEqual([{ from: 'references/guide.md', to: 'references/narrow-2-guide.md' }])
  })
})

describe('planReferenceRewrite (design §16.7)', () => {
  const body = [
    '# narrow',
    '',
    'See references/guide.md for the detail.',
    '',
    'A URL tail https://example.com/references/guide.md is not a citation.',
    '',
    '```',
    '- sample → references/guide.md',
    '```',
    '',
  ].join('\n')

  it('an identity move needs no edit and leaves nothing dangling', () => {
    const plan = planReferenceRewrite({
      content: body,
      files: ['references/guide.md'],
      moves: [{ from: 'references/guide.md', to: 'references/guide.md' }],
      targetFiles: ['references/guide.md'],
    })
    expect(plan.edits).toEqual([])
    expect(plan.residualDangling).toEqual([])
    expect(plan.unresolved).toEqual([])
  })

  it('a renamed move produces exactly one edit, at the citation line, and ignores URL/fence tails', () => {
    const plan = planReferenceRewrite({
      content: body,
      files: ['references/guide.md'],
      moves: [{ from: 'references/guide.md', to: 'references/narrow-guide.md' }],
      targetFiles: ['references/narrow-guide.md'],
    })
    expect(plan.edits).toEqual([{ line: 3, from: 'references/guide.md', to: 'references/narrow-guide.md' }])
    expect(plan.residualDangling).toEqual([])
  })

  it('names a cited file the moves give no destination, and reports it as residual', () => {
    const plan = planReferenceRewrite({
      content: 'See references/keep.md and references/moved.md.\n',
      files: ['references/keep.md', 'references/moved.md'],
      moves: [{ from: 'references/moved.md', to: 'references/moved.md' }],
      targetFiles: ['references/moved.md'],
    })
    expect(plan.unresolved).toEqual(['references/keep.md'])
    expect(plan.residualDangling).toEqual(['references/keep.md'])
  })

  it('describes the plan in one line for the refusal message', () => {
    const plan = planReferenceRewrite({
      content: 'See references/guide.md.\n',
      files: ['references/guide.md'],
      moves: [{ from: 'references/guide.md', to: 'references/narrow-guide.md' }],
      targetFiles: ['references/narrow-guide.md'],
    })
    expect(describeReferenceRewrite(plan)).toBe('plan: re-home 1 file(s); renamed: references/guide.md->references/narrow-guide.md; rewrite 1 reference(s); residual dangling 0')
  })
})
