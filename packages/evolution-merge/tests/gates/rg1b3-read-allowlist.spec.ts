// @tier pre-tag
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'

const root = new URL('../../src/', import.meta.url)
const readFiles = ['domain/merge-snapshot.ts', 'surface/merge-view.ts', 'surface/body.ts', 'read-commands.ts', 'facts.ts', 'status.ts', 'wire-projection.ts', 'merge-routes.ts', 'doctor.ts']
const writeAllow = ['state.ts', 'approve-command.ts', 'resume-command.ts', 'runtime.ts', 'scan-run.ts', 'pending-actions.ts']

it('read modules have no loadMergeState/v4ToLegacy imports', async () => {
  for (const file of readFiles) {
    const text = await readFile(new URL(file, root), 'utf8')
    expect(text, file).not.toMatch(/from '.*state\.ts'/)
    expect(text, file).not.toMatch(/\bv4ToLegacy\b|\bloadMergeState\b/)
  }
})

it('write/lifecycle allowlist keeps legacy read for compatibility', async () => {
  const allowed = []
  for (const file of writeAllow) {
    const text = await readFile(new URL(file, root), 'utf8')
    if (/\bloadMergeState\b/.test(text)) allowed.push(file)
  }
  expect(allowed).toEqual(expect.arrayContaining(['state.ts', 'approve-command.ts', 'resume-command.ts', 'runtime.ts', 'scan-run.ts']))
})
