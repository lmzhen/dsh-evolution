// @tier pre-tag
import { expect, it } from 'vitest'
import { contentHash, type SkillLibrary } from '@deepseek-ai/dsh-evolution-core'
import { skillLibraryUndoPort } from '../src/index.ts'

it('indexes version bodies by content hash for undo preflight', async () => {
  const body = '---\nname: alpha\n---\n'
  const fake = {
    async list() { return [{ name: 'alpha' }] },
    async listVersions() { return [{ v: 1 }] },
    async readVersion() { return body },
    async read() { return null },
    async readSupportFile() { return null },
    async restoreFromArchive() { return { ok: true, message: 'ok' } },
    async archive() { return { ok: true, message: 'ok' } },
    async update() { return { ok: true, message: 'ok' } },
    async writeSupportFile() { return { ok: true, message: 'ok' } },
    async removeSupportFile() { return { ok: true, message: 'ok' } },
  } as unknown as SkillLibrary
  const port = skillLibraryUndoPort(fake)
  expect(await port.readBlob(contentHash(body))).toBe(body)
  expect(await port.readBlob('missing')).toBeNull()
})
