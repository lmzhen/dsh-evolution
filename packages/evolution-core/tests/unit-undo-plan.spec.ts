// @tier pre-tag
import { expect, it } from 'vitest'
import { BASELINE_ACTION, planUnitUndoAcross, type SkillVersion } from '../src/index.ts'

let seq = 0
function version(unitId: string, action: string, hash: string, beforeHash?: string, path?: string): SkillVersion {
  seq += 1
  return {
    v: seq,
    at: '2026-10-20T00:00:00.000Z',
    unitId,
    action,
    hash,
    chars: 1,
    ...(beforeHash === undefined ? {} : { beforeHash }),
    ...(path === undefined ? {} : { path }),
  }
}

it('plans target ops plus an archived source restore', () => {
  const target = [
    version('u1', BASELINE_ACTION, 'body-0'),
    version('u1', 'merge', 'body-1', 'body-0'),
    version('u1', BASELINE_ACTION, 'file-0', undefined, 'references/a.md'),
    version('u1', 'merge', 'file-1', 'file-0', 'references/a.md'),
  ]
  const plan = planUnitUndoAcross([
    { skill: 'target', status: 'live', entries: target },
    { skill: 'source', status: 'archived', archivedPath: 'source-2026', entries: [] },
  ])
  expect(plan.refusals).toEqual([])
  expect(plan.restores).toEqual([{ skill: 'source', archivedPath: 'source-2026' }])
  expect(plan.archiveTargets).toEqual([])
  expect(plan.ops).toEqual([
    { skill: 'target', path: 'references/a.md', remove: false, preUnitHash: 'file-0', expectedHash: 'file-1' },
    { skill: 'target', path: '', remove: false, preUnitHash: 'body-0', expectedHash: 'body-1' },
  ])
})

it('archives a target the unit created and restores the archived source', () => {
  const plan = planUnitUndoAcross([
    { skill: 'umbrella', status: 'live', createdInUnit: true, entries: [version('u1', 'create', 'new-body')] },
    { skill: 'source', status: 'archived', archivedPath: 'source-2026', entries: [] },
  ])
  expect(plan.refusals).toEqual([])
  expect(plan.archiveTargets).toEqual(['umbrella'])
  expect(plan.restores).toEqual([{ skill: 'source', archivedPath: 'source-2026' }])
  expect(plan.ops).toEqual([])
})

it('removes a support file the unit created and refuses a body with no pre-unit bytes', () => {
  const plan = planUnitUndoAcross([
    {
      skill: 'target',
      status: 'live',
      entries: [
        version('u1', 'merge', 'file-new', undefined, 'references/new.md'),
        version('u1', 'merge', 'body-new'),
      ],
    },
  ])
  expect(plan.ops).toContainEqual({ skill: 'target', path: 'references/new.md', remove: true, expectedHash: 'file-new' })
  expect(plan.refusals.join('|')).toContain('SKILL.md 缺少单元前字节')
})

it('refuses a missing member and an archived member without a path', () => {
  const plan = planUnitUndoAcross([
    { skill: 'gone', status: 'missing', entries: [] },
    { skill: 'archived', status: 'archived', entries: [] },
  ])
  expect(plan.refusals).toHaveLength(2)
  expect(plan.ops).toEqual([])
  expect(plan.restores).toEqual([])
})
