// @tier pre-tag
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo, UnitTransactions, type UnitBackend } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../../test-support/temp-home.ts'

const POINTS = ['prepared', 'target-pending', 'target-applied', 'target-written', 'source-archiving', 'sources-archived', 'unit-written', 'committed'] as const

async function waitFor(path: string, timeoutMs: number): Promise<string> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try { return await readFile(path, 'utf8') } catch { await new Promise(resolve => setTimeout(resolve, 25)) }
  }
  throw new Error('timeout waiting for ' + path)
}

for (const point of POINTS) {
  it('force-kills at ' + point, async () => {
    const home = await tempRoot('dsh-rg3-crash-')
    const core = new URL('../../../evolution-core/src/unit-transaction.ts', import.meta.url).href
    const ioUrl = new URL('../../../evolution-core/src/io.ts', import.meta.url).href
    const scriptPath = join(home, 'crash.mts')
    const pidPath = join(home, 'child.pid')
    await writeFile(scriptPath, `
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { UnitTransactions } from ${JSON.stringify(core)}
import { nodeEvolutionIo } from ${JSON.stringify(ioUrl)}
const tree = ${JSON.stringify(home)} + '/tree'
const tx = new UnitTransactions({
  io: nodeEvolutionIo(), home: ${JSON.stringify(home)},
  backend: { async readSkill(n) { return n === 'alpha' ? 'old' : 'beta' }, async readSupportFile() { return null }, async commit(_p, onPhase) { await onPhase?.('target-pending'); await mkdir(tree, { recursive: true }); await writeFile(tree + '/alpha', 'new'); await onPhase?.('target-applied'); await onPhase?.('target-written'); await onPhase?.('source-archiving', { source: 'beta' }); await rm(tree + '/beta', { force: true }); await onPhase?.('sources-archived'); await onPhase?.('unit-written'); return { ok: true, message: 'merged', archived: ['beta'], mutations: 1 } }, async restoreTarget() {}, async restoreSource() {} },
  claim: { async acquire() { return { async release() {} } } }, now: () => 1,
  onPhase: async (phase) => { if (phase === ${JSON.stringify(point)}) { await writeFile(${JSON.stringify(pidPath)}, String(process.pid)); await new Promise(() => { setInterval(() => {}, 1000) }) } },
})
const p = await tx.prepare({ runId: 'run-1', pairKey: 'alpha', target: 'alpha', targetExists: true, sources: ['beta'], body: 'new', supportFiles: [], expectedTargetBody: 'old', expectedSourceBodies: [{ name: 'beta', body: 'beta' }], origin: 'foreground', summary: 's' })
if (!p.ok) process.exit(2)
await tx.commit(p.prepared)
`)
    await mkdir(join(home, 'tree'), { recursive: true })
    await writeFile(join(home, 'tree', 'alpha'), 'old')
    await writeFile(join(home, 'tree', 'beta'), 'beta')
    const child = spawn(join(process.cwd(), 'node_modules', '.bin', 'tsx.cmd'), [scriptPath], { shell: true, stdio: 'ignore' })
    const pid = Number(await waitFor(pidPath, 20_000))
    const killed = spawnSync('taskkill', ['/F', '/PID', String(pid)], { encoding: 'utf8' })
    expect(killed.status, killed.stderr).toBe(0)
    await new Promise<void>(resolve => child.once('exit', () => resolve()))
    const dir = join(home, 'merge', 'unit-journals')
    const files = await readdir(dir)
    const journal = JSON.parse(await readFile(join(dir, files[0]!), 'utf8')) as { phase: string; unitId: string }
    expect(journal.phase).toBe(point === 'unit-written' ? 'sources-archived' : point === 'target-applied' ? 'target-pending' : point)
    const alpha = await readFile(join(home, 'tree', 'alpha'), 'utf8').catch(() => null)
    const beta = await readFile(join(home, 'tree', 'beta'), 'utf8').catch(() => null)
    if (point === 'prepared' || point === 'target-pending') {
      expect(alpha, 'target before').toBe('old')
      expect(beta, 'source before').toBe('beta')
    } else if (point === 'target-applied' || point === 'target-written' || point === 'source-archiving') {
      expect(alpha, 'target after').toBe('new')
      expect(beta, 'source not yet archived').toBe('beta')
    } else {
      expect(alpha, 'target after').toBe('new')
      expect(beta, 'source archived').toBeNull()
    }
    const treeBackend: UnitBackend = {
      async readSkill(name) { return await readFile(join(home, 'tree', name), 'utf8').catch(() => null) },
      async readSupportFile() { return null },
      async commit() { throw new Error('must not commit after crash') },
      async restoreTarget(name, body) { await mkdir(join(home, 'tree'), { recursive: true }); if (body === null) await rm(join(home, 'tree', name), { force: true }); else await writeFile(join(home, 'tree', name), body) },
      async restoreSource(name, body) { await mkdir(join(home, 'tree'), { recursive: true }); await writeFile(join(home, 'tree', name), body) },
    }
    const tx = new UnitTransactions({ io: nodeEvolutionIo(), home, backend: treeBackend, claim: { async acquire() { return { async release() {} } } }, now: () => 2 })
    if (point === 'unit-written') {
      const refused = await tx.rollback({ unitId: journal.unitId, reason: 'crash' })
      expect(refused.ok).toBe(false)
      if (!refused.ok) expect(refused.code).toBe('unit-committed')
    }
    const recovered = point === 'committed' || point === 'unit-written'
      ? await tx.finalize(journal.unitId)
      : point === 'sources-archived'
        ? await tx.rollForward(journal.unitId)
        : await tx.rollback({ unitId: journal.unitId, reason: 'crash' })
    expect(recovered.ok).toBe(true)
    expect(await readFile(join(home, 'tree', 'alpha'), 'utf8').catch(() => null)).toBe(point === 'committed' || point === 'unit-written' || point === 'sources-archived' ? 'new' : 'old')
    expect(await readFile(join(home, 'tree', 'beta'), 'utf8').catch(() => null)).toBe(point === 'committed' || point === 'unit-written' || point === 'sources-archived' ? null : 'beta')
  }, 60_000)
}
