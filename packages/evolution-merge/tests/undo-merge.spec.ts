// @tier pre-tag
import { expect, it } from 'vitest'
import { contentHash, type SkillVersion } from '@deepseek-ai/dsh-evolution-core'
import { undoMergeReceipt, type CommitReceipt, type MergeUndoPort } from '../src/index.ts'

const AT = '2026-10-20T00:00:00.000Z'
const version = (v: number, action: string, hash: string, beforeHash?: string): SkillVersion => ({
  v, at: AT, unitId: 'u-1', action, hash, chars: 1, ...(beforeHash === undefined ? {} : { beforeHash }),
})

it('undoes a merge receipt by restoring the source and target body', async () => {
  const body0 = 'body-0'
  const body1 = 'body-1'
  const state = {
    target: body1,
    source: null as string | null,
    archived: true,
    calls: [] as string[],
  }
  const port: MergeUndoPort = {
    async listVersions(skill) {
      return skill === 'target'
        ? [version(1, 'baseline', contentHash(body0)), version(2, 'merge', contentHash(body1), contentHash(body0))]
        : [version(3, 'archive', contentHash('src'))]
    },
    async readSkill(skill) { return skill === 'target' ? state.target : state.source },
    async readSupport() { return null },
    async readBlob(hash) { return hash === contentHash(body0) ? body0 : null },
    async hasArchived() { return state.archived },
    async restoreFromArchive(skill) { state.calls.push('restore:' + skill); state.archived = false; return { ok: true, message: 'restored' } },
    async archive(skill) { state.calls.push('archive:' + skill); return { ok: true, message: 'archived' } },
    async updateSkill(skill, body, anchor) {
      if (contentHash(state.target) !== anchor.sha256) return { ok: false, message: 'anchor' }
      state.target = body
      state.calls.push('update:' + skill)
      return { ok: true, message: 'updated' }
    },
    async writeSupportFile() { return { ok: true, message: 'written' } },
    async removeSupportFile() { return { ok: true, message: 'removed' } },
  }
  const receipt: CommitReceipt = { runId: 'run-1', unitId: 'u-1', target: 'target', create: false, sources: ['source'], archived: ['source'], at: 1 }
  const result = await undoMergeReceipt(receipt, port)
  expect(result.ok).toBe(true)
  expect(state.target).toBe(body0)
  expect(state.calls).toEqual(['restore:source', 'update:target'])
})
