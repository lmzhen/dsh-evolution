import { describe, expect, it } from 'vitest'
import { isFileShapedPath, resolveCitations, scanBodyHooks } from '@deepseek-ai/dsh-evolution-core'

const files = ['references/x.md', 'references/archive/old.md', 'templates/a.tmpl', 'scripts/build.mjs']

const scan = (content: string, list: readonly string[] = files): ReturnType<typeof resolveCitations> =>
  resolveCitations({ content, file: 'SKILL.md', files: list })

describe('resolveCitations (design §5.2)', () => {
  it('resolves support-dir citations from the skill root', () => {
    const report = scan('见 references/x.md 与 templates/a.tmpl')
    expect(report.refs.map(ref => ref.target)).toEqual(['references/x.md', 'templates/a.tmpl'])
    expect(report.dangling).toEqual([])
    expect(report.foreign).toEqual([])
  })

  it('reports a citation whose target is absent as dangling', () => {
    const report = scan('见 references/missing.md')
    expect(report.dangling.map(ref => ref.target)).toEqual(['references/missing.md'])
    expect(report.refs[0]?.exists).toBe(false)
  })

  it('treats an archived support file as an existing target', () => {
    expect(scan('历史见 references/archive/old.md').dangling).toEqual([])
  })

  it('classifies a URL tail as url, never as a citation', () => {
    const report = scan('见 https://example.com/references/z.md 的说明')
    expect(report.refs.map(ref => ref.kind)).toEqual(['url'])
    expect(report.dangling).toEqual([])
    expect(report.foreign).toHaveLength(1)
  })

  it('classifies a category path as foreign (the original Hermes whitelists it)', () => {
    const report = scan('合法分类名 `skills/scripts/foo.py` 仍在')
    expect(report.refs.map(ref => ref.kind)).toEqual(['foreign'])
    expect(report.refs[0]?.target).toBeNull()
  })

  it('classifies a prose command line as prose', () => {
    const report = scan('跑 npm run scripts/build.mjs 即可')
    expect(report.refs.map(ref => ref.kind)).toEqual(['prose'])
    expect(report.dangling).toEqual([])
  })

  it('classifies tokens inside a fenced code block as fence', () => {
    const fence = '```'
    const report = scan('示例：\n\n' + fence + '\nnode scripts/build.mjs\nreferences/whatever.md\n' + fence + '\n')
    expect(report.refs).toHaveLength(2)
    expect(report.refs.every(ref => ref.kind === 'fence')).toBe(true)
    expect(report.dangling).toEqual([])
  })

  it('strips sentence punctuation before deciding existence', () => {
    const report = scan('见 references/x.md。以及 references/x.md, 结束')
    expect(report.refs.map(ref => ref.target)).toEqual(['references/x.md'])
    expect(report.refs[0]?.raw).toBe('references/x.md')
  })

  it('keeps a #fragment out of the target and off the existence check', () => {
    const report = scan('见 references/x.md#section-2')
    expect(report.refs[0]?.target).toBe('references/x.md')
    expect(report.refs[0]?.fragment).toBe('section-2')
    expect(report.dangling).toEqual([])
  })

  it('does not resolve a ./ prefixed token (documented narrowing)', () => {
    expect(scan('见 ./references/x.md').refs.map(ref => ref.kind)).toEqual(['foreign'])
  })

  it('treats a dotless directory mention as prose, not a citation', () => {
    const report = scan('布局：references/templates/scripts 三类子目录')
    expect(report.refs.map(ref => ref.kind)).toEqual(['prose'])
    expect(report.dangling).toEqual([])
  })

  it('reports a nested target a non-recursive listing cannot decide as unverified', () => {
    const report = scan('历史见 references/archive/old.md', ['references/archive'])
    expect(report.dangling).toEqual([])
    expect(report.unverified.map(ref => ref.target)).toEqual(['references/archive/old.md'])
  })

  it('dedupes the same token on one line', () => {
    expect(scan('references/x.md 与 references/x.md').refs).toHaveLength(1)
  })

  it('marks a report that stopped at the budget as truncated', () => {
    const content = Array.from({ length: 30 }, (_, i) => '- references/f' + String(i) + '.md').join('\n')
    const report = resolveCitations({ content, file: 'SKILL.md', files: [], budget: 5 })
    expect(report.truncated).toBe(true)
    expect(report.refs).toHaveLength(5)
  })

  it('answers an empty report for empty content', () => {
    expect(scan('')).toEqual({ refs: [], dangling: [], unverified: [], foreign: [], truncated: false })
  })
})

describe('scanBodyHooks (design §5.6)', () => {
  it('accepts a sanctioned hook line and reads its target', () => {
    const scan = scanBodyHooks('- schema 校验失败怎么办 → references/x.md\n')
    expect(scan.targets).toEqual(['references/x.md'])
    expect(scan.kept.size).toBe(0)
  })

  it('records the keep marker with its target and reason', () => {
    const scan = scanBodyHooks('<!-- keep: references/x.md 等上游修复 -->\n')
    expect(scan.targets).toEqual([])
    expect(scan.kept.get('references/x.md')).toBe('等上游修复')
  })

  it('refuses an over-long label, trailing prose and a bare mention', () => {
    expect(scanBodyHooks(`- ${'x'.repeat(61)} → references/x.md`).targets).toEqual([])
    expect(scanBodyHooks('- label → references/x.md 补充说明').targets).toEqual([])
    expect(scanBodyHooks('见 references/x.md').targets).toEqual([])
  })

  it('refuses a keep marker without a reason or without a path', () => {
    expect(scanBodyHooks('<!-- keep: references/x.md -->').kept.size).toBe(0)
    expect(scanBodyHooks('<!-- keep: 这条先留着 -->').kept.size).toBe(0)
  })

  it('ignores hook-shaped sample lines inside a fenced block', () => {
    const body = '```\n- 示例 → references/x.md\n```\n- 真钩子 → references/y.md\n'
    expect(scanBodyHooks(body).targets).toEqual(['references/y.md'])
  })

  it('separates a directory entry from a file-shaped path', () => {
    // The support listing is one level deep and includes directory entries.
    expect(isFileShapedPath('references/archive')).toBe(false)
    expect(isFileShapedPath('references/archive/old.md')).toBe(true)
    expect(isFileShapedPath('references/.gitkeep')).toBe(false)
    expect(isFileShapedPath('scripts/build.mjs')).toBe(true)
  })

  it('reads CRLF bodies and deduplicates repeated hooks', () => {
    expect(scanBodyHooks('- 症状 → references/x.md\r\n- 另一症状 → references/x.md\r\n').targets).toEqual(['references/x.md'])
  })
})

