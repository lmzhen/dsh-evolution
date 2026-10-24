// @tier pre-tag
import { expect, it } from 'vitest'
import { MERGE_COMMANDS, MERGE_COMMAND_SURFACE } from '../src/command-surface.ts'

it('freezes all 19 commands as JSON-safe specs', () => {
  expect(MERGE_COMMAND_SURFACE.wireVersion).toBe(1)
  expect(MERGE_COMMAND_SURFACE.prefix).toBe('/evolution merge')
  expect(MERGE_COMMANDS).toHaveLength(19)
  expect(new Set(MERGE_COMMANDS.map(item => item.id)).size).toBe(19)
  for (const item of MERGE_COMMANDS) {
    expect(item.summary).toBe(item.id)
    expect(item.fallback.startsWith('/evolution merge ')).toBe(true)
    expect(JSON.parse(JSON.stringify(item))).toEqual(item)
  }
  expect(MERGE_COMMANDS.filter(item => item.readOnly).map(item => item.id)).toEqual(['merge.status', 'merge.report', 'merge.runs', 'merge.pending', 'merge.pending.expired', 'merge.skipped', 'merge.candidates', 'merge.resume'])
})
