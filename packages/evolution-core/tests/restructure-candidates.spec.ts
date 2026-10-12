/*
 * G3: the candidate list and the store's anchor validation read the SAME H2 scan, so a candidate
 * can never name a heading the store would refuse. This spec pins the two refusals that used to be
 * reachable from a hand-written anchor: a heading that does not exist, and an ambiguous one.
 */
import { expect, it } from 'vitest'
import { h2Sections, restructureCandidates } from '../src/document-body.ts'

const body = [
  '# Title',
  '',
  'Intro line.',
  '',
  '## Unique',
  'content of the unique section',
  '',
  '## Dup',
  'first copy',
  '',
  '## Dup',
  'second copy',
  '',
  '## Empty',
  '## Tail',
  'tail body',
].join(String.fromCharCode(10))

it('候选只出唯一且非空的 H2（歧义/空节不入候选）', () => {
  const names = restructureCandidates(body).map(c => c.heading)
  expect(names).toContain('Unique')
  expect(names).toContain('Tail')
  expect(names).not.toContain('Dup')
  expect(names).not.toContain('Empty')
  expect(names).not.toContain('Title')
})

it('候选的目标文件是 references 下的 markdown', () => {
  for (const candidate of restructureCandidates(body)) {
    expect(candidate.toFile.startsWith('references/')).toBe(true)
    expect(candidate.toFile.endsWith('.md')).toBe(true)
  }
})

it('扫描本身仍报告歧义与空节（候选只是把它过滤掉，不是改判）', () => {
  const sections = h2Sections(body)
  expect(sections.find(s => s.title === 'Dup')?.count).toBe(2)
  expect(sections.find(s => s.title === 'Empty')?.end).toBe(sections.find(s => s.title === 'Empty')!.start + 1)
})
