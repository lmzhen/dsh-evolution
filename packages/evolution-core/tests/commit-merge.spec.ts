// @tier pre-tag
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'

const BODY = (name: string, extra = '') => `---
name: ${name}
description: A merge fixture skill.
---

# ${name}

Body of ${name}.
${extra}`

it('commitMerge archives sources and writes the target with one unit', async () => {
  const root = await tempRoot('dsh-commit-merge-')
  const lib = new SkillLibrary(root)
  await lib.create('target-skill', BODY('target-skill'), 'foreground')
  await lib.create('src-a', BODY('src-a'), 'foreground')
  await lib.create('src-b', BODY('src-b'), 'foreground')
  const targetBody = (await lib.read('target-skill')) ?? ''
  const sourceBodies = [
    { name: 'src-a', body: (await lib.read('src-a')) ?? '' },
    { name: 'src-b', body: (await lib.read('src-b')) ?? '' },
  ]
  const merged = BODY('target-skill', '## Merged\n\nSee references/merged.md\n')
  const result = await lib.commitMerge({
    target: 'target-skill',
    targetExists: true,
    sources: ['src-a', 'src-b'],
    body: merged,
    supportFiles: [{ path: 'references/merged.md', content: '# merged\n' }],
    expectedTargetBody: targetBody,
    expectedSourceBodies: sourceBodies,
    origin: 'foreground',
    summary: 'merge two sources',
  })
  expect(result).toMatchObject({ ok: true, mutations: 3, archived: ['src-a', 'src-b'] })
  expect(await lib.read('target-skill')).toContain('## Merged')
  expect(await lib.read('src-a')).toBeNull()
  expect(await lib.read('src-b')).toBeNull()
  expect(await readFile(join(root, 'target-skill', 'references', 'merged.md'), 'utf8')).toBe('# merged\n')
  const targetVersions = await lib.listVersions('target-skill')
  expect(targetVersions.some(v => v.unitId === result.unitId)).toBe(true)
  expect((await lib.listVersions('src-a')).some(v => v.unitId === result.unitId)).toBe(true)
})

it('commitMerge creates the umbrella target first, then archives sources', async () => {
  const root = await tempRoot('dsh-commit-merge-create-')
  const lib = new SkillLibrary(root)
  await lib.create('src-a', BODY('src-a'), 'foreground')
  await lib.create('src-b', BODY('src-b'), 'foreground')
  const sourceBodies = [
    { name: 'src-a', body: (await lib.read('src-a')) ?? '' },
    { name: 'src-b', body: (await lib.read('src-b')) ?? '' },
  ]
  const result = await lib.commitMerge({
    target: 'umbrella',
    targetExists: false,
    sources: ['src-a', 'src-b'],
    body: BODY('umbrella', '## Merged\n'),
    supportFiles: [{ path: 'references/merged.md', content: '# merged\n' }],
    expectedTargetBody: null,
    expectedSourceBodies: sourceBodies,
    origin: 'foreground',
    summary: 'create umbrella',
  })
  expect(result).toMatchObject({ ok: true, mutations: 3, archived: ['src-a', 'src-b'] })
  expect(await lib.read('umbrella')).toContain('## Merged')
  expect(await lib.read('src-a')).toBeNull()
  expect(await readFile(join(root, 'umbrella', 'references', 'merged.md'), 'utf8')).toBe('# merged\n')
})


it('commitMerge rolls a created target back when a source archive fails', async () => {
  const root = await tempRoot('dsh-commit-merge-rollback-')
  const lib = new SkillLibrary(root)
  await lib.create('src-a', BODY('src-a'), 'foreground')
  const sourceBody = (await lib.read('src-a')) ?? ''
  const original = lib.archive.bind(lib)
  vi.spyOn(lib, 'archive').mockImplementation(async (name, options, origin) => {
    if (name === 'src-a') return { ok: false, message: 'archive-boom' }
    return await original(name, options, origin)
  })
  const result = await lib.commitMerge({
    target: 'umbrella',
    targetExists: false,
    sources: ['src-a'],
    body: BODY('umbrella'),
    supportFiles: [],
    expectedTargetBody: null,
    expectedSourceBodies: [{ name: 'src-a', body: sourceBody }],
    origin: 'foreground',
    summary: 'rollback test',
  })
  expect(result.ok).toBe(false)
  expect(result.message).toContain('archive-boom')
  expect(await lib.read('umbrella')).toBeNull()
  expect(await lib.read('src-a')).toBe(sourceBody)
  vi.restoreAllMocks()
})

it('commitMerge refuses target protection and stale source bytes without side effects', async () => {
  const root = await tempRoot('dsh-commit-merge-guard-')
  const lib = new SkillLibrary(root)
  await lib.create('target-skill', BODY('target-skill'), 'foreground')
  await lib.create('src-a', BODY('src-a'), 'foreground')
  await lib.setPinned('src-a', true, 'foreground')
  const targetBody = (await lib.read('target-skill')) ?? ''
  const sourceBody = (await lib.read('src-a')) ?? ''
  const planned = {
    target: 'target-skill',
    targetExists: true,
    sources: ['src-a'],
    body: BODY('target-skill', '## Merged\n'),
    supportFiles: [],
    expectedTargetBody: targetBody,
    expectedSourceBodies: [{ name: 'src-a', body: sourceBody }],
    origin: 'foreground' as const,
    summary: 'guard test',
  }
  expect((await lib.commitMerge(planned)).ok).toBe(false)
  expect(await lib.read('src-a')).toBe(sourceBody)

  await lib.setPinned('src-a', false, 'foreground')
  planned.expectedSourceBodies = [{ name: 'src-a', body: sourceBody + 'changed' }]
  expect((await lib.commitMerge(planned)).ok).toBe(false)
  expect(await lib.read('src-a')).toBe(sourceBody)
  expect(await lib.read('target-skill')).toBe(targetBody)
})
