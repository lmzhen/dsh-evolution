// @tier pre-tag
import { expect, it } from 'vitest'
import { contentHash, executeUnitUndo, type UnitUndoSink, type UnitUndoPlan } from '../src/index.ts'

interface State {
  skills: Map<string, string>
  supports: Map<string, string>
  blobs: Map<string, string>
  archived: Set<string>
  calls: string[]
}

function sinkOf(state: State): UnitUndoSink {
  return {
    async readSkill(skill) { return state.skills.get(skill) ?? null },
    async readSupport(skill, path) { return state.supports.get(skill + '/' + path) ?? null },
    async readBlob(hash) { return state.blobs.get(hash) ?? null },
    async hasArchived(skill) { return state.archived.has(skill) },
    async restoreFromArchive(skill) {
      state.calls.push('restore:' + skill)
      if (!state.archived.delete(skill)) return { ok: false, message: 'not archived' }
      return { ok: true, message: 'restored' }
    },
    async archive(skill, reason) {
      state.calls.push('archive:' + skill + ':' + reason)
      state.skills.delete(skill)
      return { ok: true, message: 'archived' }
    },
    async updateSkill(skill, body, anchor) {
      state.calls.push('update:' + skill)
      if (contentHash(state.skills.get(skill) ?? '') !== anchor.sha256) return { ok: false, message: 'anchor mismatch' }
      state.skills.set(skill, body)
      return { ok: true, message: 'updated' }
    },
    async writeSupportFile(skill, path, body, anchor) {
      state.calls.push('write:' + skill + '/' + path)
      if (contentHash(state.supports.get(skill + '/' + path) ?? '') !== anchor.sha256) return { ok: false, message: 'anchor mismatch' }
      state.supports.set(skill + '/' + path, body)
      return { ok: true, message: 'written' }
    },
    async removeSupportFile(skill, path, anchor) {
      state.calls.push('remove:' + skill + '/' + path)
      if (contentHash(state.supports.get(skill + '/' + path) ?? '') !== anchor.sha256) return { ok: false, message: 'anchor mismatch' }
      state.supports.delete(skill + '/' + path)
      return { ok: true, message: 'removed' }
    },
  }
}

it('restores sources, applies supports, then the body', async () => {
  const state: State = { skills: new Map(), supports: new Map(), blobs: new Map(), archived: new Set(), calls: [] }
  const body0 = 'body-0'
  const body1 = 'body-1'
  const support0 = 'support-0'
  const support1 = 'support-1'
  state.skills.set('target', body1)
  state.supports.set('target/references/a.md', support1)
  state.blobs.set(contentHash(body0), body0)
  state.blobs.set(contentHash(support0), support0)
  state.archived.add('source')
  const plan: UnitUndoPlan = {
    restores: [{ skill: 'source', archivedPath: 'source-archive' }],
    archiveTargets: [],
    refusals: [],
    ops: [
      { skill: 'target', path: 'references/a.md', remove: false, preUnitHash: contentHash(support0), expectedHash: contentHash(support1) },
      { skill: 'target', path: '', remove: false, preUnitHash: contentHash(body0), expectedHash: contentHash(body1) },
    ],
  }
  const result = await executeUnitUndo(plan, sinkOf(state))
  expect(result.ok).toBe(true)
  expect(state.calls).toEqual(['restore:source', 'write:target/references/a.md', 'update:target'])
  expect(state.skills.get('target')).toBe(body0)
  expect(state.supports.get('target/references/a.md')).toBe(support0)
  expect(state.archived.has('source')).toBe(false)
})

it('writes nothing when an anchor or blob is missing', async () => {
  const state: State = { skills: new Map([['target', 'changed']]), supports: new Map(), blobs: new Map(), archived: new Set(), calls: [] }
  const plan: UnitUndoPlan = {
    restores: [],
    archiveTargets: [],
    refusals: [],
    ops: [{ skill: 'target', path: '', remove: false, preUnitHash: contentHash('old'), expectedHash: contentHash('expected') }],
  }
  const result = await executeUnitUndo(plan, sinkOf(state))
  expect(result.ok).toBe(false)
  expect(result.reverted).toEqual([])
  expect(state.calls).toEqual([])

  const missing: State = { skills: new Map([['target', 'expected']]), supports: new Map(), blobs: new Map(), archived: new Set(), calls: [] }
  const missingResult = await executeUnitUndo(plan, sinkOf(missing))
  expect(missingResult.ok).toBe(false)
  expect(missingResult.message).toContain('预检未通过')
  expect(missing.calls).toEqual([])
})

it('archives a target the unit created', async () => {
  const state: State = { skills: new Map([['umbrella', 'new']]), supports: new Map(), blobs: new Map(), archived: new Set(), calls: [] }
  const plan: UnitUndoPlan = { restores: [], ops: [], archiveTargets: ['umbrella'], refusals: [] }
  const result = await executeUnitUndo(plan, sinkOf(state))
  expect(result.ok).toBe(true)
  expect(state.calls).toEqual(['archive:umbrella:merge undone'])
  expect(state.skills.has('umbrella')).toBe(false)
})
