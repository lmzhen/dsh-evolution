// @tier pre-tag
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { sep } from 'node:path'
import { readCommitReceipts } from '../src/commit-receipt.ts'

function io(files: Record<string, string>) {
  const map = new Map(Object.entries(files))
  return { async readText(p: string) { return map.get(p) ?? null }, async writeText(p: string, c: string) { map.set(p, c) }, async remove(p: string) { map.delete(p) }, async list(p: string) { return [...new Set([...map.keys()].filter(k => k.startsWith(p + '\\')).map(k => k.slice(p.length + 1).split('\\')[0] as string))] }, async exists(p: string) { return map.has(p) }, async rename() {}, async copy() {} }
}

it('reads durable receipts and ignores malformed files', async () => {
  const receipt = { runId: 'r1', unitId: 'u1', target: 't', create: false, sources: ['s'], archived: ['s'], at: 1 }
  const store = io({ 'H\\merge\\receipts\\r1\\a.json': JSON.stringify(receipt), 'H\\merge\\receipts\\r1\\bad.json': '{bad' })
  const rows = await readCommitReceipts(store as never, 'H')
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.target, 't')
})
