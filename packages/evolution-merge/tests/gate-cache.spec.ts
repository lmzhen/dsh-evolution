// @tier pre-tag
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { GateCache, gateCachePath, loadGateCache, saveGateCache, selectedForAudit, type GateVerdict } from '../src/index.ts'

const verdict: GateVerdict = { level: 'L2', verdict: 1, reason: 'same', evidence: [], cached: false }

it('round-trips the gate cache and reports malformed files', async () => {
  const home = await tempRoot('dsh-merge-gate-cache-')
  const io = nodeEvolutionIo()
  const cache = new GateCache()
  cache.put('k1', verdict)
  await saveGateCache(io, home, cache)
  const loaded = await loadGateCache(io, home)
  expect(loaded.note).toBeUndefined()
  expect(loaded.cache.size).toBe(1)
  expect(loaded.cache.get('k1')).toMatchObject({ verdict: 1, cached: true })
  await io.writeText(gateCachePath(home), 'not-json')
  expect((await loadGateCache(io, home)).note).toContain('not JSON')
})

it('selects audit pairs deterministically', () => {
  const selected = Array.from({ length: 200 }, (_, index) => selectedForAudit('pair-' + String(index), 'seed', 0.1))
  expect(selected.some(value => value)).toBe(true)
  expect(selectedForAudit('pair-1', 'seed', 0.1)).toBe(selectedForAudit('pair-1', 'seed', 0.1))
  expect(selectedForAudit('pair-1', 'seed', 0)).toBe(false)
  expect(selectedForAudit('pair-1', 'seed', 1)).toBe(true)
})
