// @tier pre-tag
import { expect, it } from 'vitest'
import { validateStagedTree, hasBlockingFinding } from '../src/index.ts'

const BODY = (extra = '') => ['---', 'name: umbrella', 'description: short', '---', '', '# umbrella', '', extra, ''].join('\n')

it('accepts a clean staged tree', () => {
  const findings = validateStagedTree({
    target: 'umbrella',
    body: BODY('See references/x.md'),
    files: [{ path: 'references/x.md', content: 'x' }],
  })
  expect(findings).toEqual([])
  expect(hasBlockingFinding(findings)).toBe(false)
})

it('blocks bad frontmatter, unsafe paths and missing references', () => {
  const findings = validateStagedTree({
    target: 'umbrella',
    body: BODY('See references/missing.md'),
    files: [{ path: '../x', content: 'x' }],
  })
  expect(findings.some(f => f.rule === 'path' && f.severity === 'block')).toBe(true)
  expect(findings.some(f => f.rule === 'refs-pair' && f.severity === 'block')).toBe(true)
  expect(hasBlockingFinding(findings)).toBe(true)
})

it('warns for placeholders and long descriptions without blocking', () => {
  const long = 'a'.repeat(80)
  const body = ['---', 'name: umbrella', 'description: ' + long, '---', '', 'TODO', ''].join('\n')
  const findings = validateStagedTree({
    target: 'umbrella',
    body,
    files: [],
  })
  // placeholder and desc-length are warnings; the body has no malformed frontmatter.
  expect(findings.some(f => f.rule === 'placeholder' && f.severity === 'warn')).toBe(true)
  expect(findings.some(f => f.rule === 'desc-length' && f.severity === 'warn')).toBe(true)
  expect(findings.filter(f => f.severity === 'block')).toEqual([])
})
