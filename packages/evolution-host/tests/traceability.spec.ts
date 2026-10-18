// @tier pre-tag
/**
 * W11/G7 traceability gate — behaviour, not a green-tree re-run: the mechanical mutations a stale or
 * dishonest ledger would ship (a dropped item, an unknown id, a duplicate, an empty matrix, an
 * unsorted portfolio, a disposition without a reason) must each fail loudly, and the budget must be
 * re-derived rather than trusted.
 */
import { describe, expect, it, vi } from 'vitest'
vi.setConfig({ testTimeout: 30_000 })
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { tempRoot } from '../../test-support/temp-home.ts'

const run = promisify(execFile)
const script = fileURLToPath(new URL('../../scripts/verify-traceability.mjs', import.meta.url))
const ledgerPath = fileURLToPath(new URL('../../scripts/traceability.json', import.meta.url))

interface TraceItem { id: string; note?: string; trigger?: string; [key: string]: unknown }
interface TraceLedger { items: TraceItem[]; budget: Record<string, unknown>; [key: string]: unknown }

async function fixture(asset: TraceLedger): Promise<string> {
  const root = await tempRoot('traceability-')
  await mkdir(join(root, 'scripts'), { recursive: true })
  await writeFile(join(root, 'scripts', 'traceability.json'), JSON.stringify(asset, null, 2), 'utf8')
  return root
}

async function runGate(root: string, args: string[] = ['--planned']): Promise<{ code: number; stdout: string; stderr: string }> {
  return await run(process.execPath, [script, root, ...args], { encoding: 'utf8' })
    .then(out => ({ code: 0, stdout: out.stdout, stderr: out.stderr }))
    .catch((error: unknown) => {
      const failure = error as { code?: number; stdout?: string; stderr?: string }
      return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
    })
}

const real = JSON.parse(readFileSync(ledgerPath, 'utf8')) as TraceLedger

describe('verify-traceability: the ledger can fail', () => {
  it('passes the real 52-item ledger in planned mode', async () => {
    const root = await fixture(real)
    try {
      const result = await runGate(root)
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('52/52')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('a dropped item is a missing universe entry', async () => {
    const asset = { ...real, items: real.items.filter(item => item.id !== 'A-01') }
    const root = await fixture(asset)
    try {
      const result = await runGate(root)
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('A-01')
      expect(result.stderr).toContain('missing')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('an unknown, duplicate or unsorted row fails', async () => {
    const unknown = { ...real, items: [...real.items, { ...real.items[0], id: 'A-23' }] }
    const rootA = await fixture(unknown)
    try { expect((await runGate(rootA)).code).toBe(1) } finally { await rm(rootA, { recursive: true, force: true }) }
    const duplicate = { ...real, items: [...real.items, real.items[0]] }
    const rootB = await fixture(duplicate)
    try {
      const result = await runGate(rootB)
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('duplicate')
    } finally { await rm(rootB, { recursive: true, force: true }) }
    const unsorted = { ...real, items: [real.items[1], real.items[0], ...real.items.slice(2)] }
    const rootC = await fixture(unsorted)
    try {
      const result = await runGate(rootC)
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('canonical order')
    } finally { await rm(rootC, { recursive: true, force: true }) }
  })

  it('an empty matrix cannot decide (exit 2), and a disposition without a reason is a violation', async () => {
    const rootA = await fixture({ ...real, items: [] })
    try { expect((await runGate(rootA)).code).toBe(2) } finally { await rm(rootA, { recursive: true, force: true }) }
    const asset = { ...real, items: real.items.map(item => item.id === 'B-06' ? { ...item, trigger: undefined } : item) }
    const target = asset.items.find(item => item.id === 'B-06')
    if (target === undefined) throw new Error('fixture: B-06 is missing')
    delete target.note
    const rootB = await fixture(asset)
    try {
      const result = await runGate(rootB)
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('without a trigger or note')
    } finally { await rm(rootB, { recursive: true, force: true }) }
  })

  it('strict mode re-derives the budget instead of trusting it', async () => {
    const asset = { ...real, budget: { ...real.budget, newSubpaths: 5 } }
    const root = await fixture(asset)
    try {
      const result = await runGate(root, [])
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('budget.newSubpaths=5')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
