// @tier pre-tag
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const src = fileURLToPath(new URL('../../src', import.meta.url))

async function files(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...await files(join(dir, entry.name)))
    else if (entry.name.endsWith('.ts')) out.push(join(dir, entry.name))
  }
  return out
}

it('has no legacy production writer and only the read-only v2 projection', async () => {
  const all = await files(src)
  const writers: string[] = []
  for (const path of all) {
    if (path.endsWith('state.ts')) continue
    const text = await readFile(path, 'utf8')
    if (/\bupsertRow\(/.test(text) || /\bdropRow\(/.test(text) || /\bmoveRow\(/.test(text)) writers.push(path)
  }
  expect(writers).toEqual([])
  const coordinatorUsers: string[] = []
  for (const path of all) {
    if (path.endsWith('coordinator.ts')) continue
    const text = await readFile(path, 'utf8')
    if (text.includes('transitionLegacyForProjection(')) coordinatorUsers.push(path)
  }
  expect(coordinatorUsers).toEqual([])
})

it('all production state writes go through RowTx or terminal drop', async () => {
  const all = await files(src)
  const text = (await Promise.all(all.map(path => readFile(path, 'utf8')))).join('\n')
  expect(text).toContain('transactRows(')
  expect(text).toContain('dropRowV3(')
  expect(text).toContain('transitionV3(')
})
