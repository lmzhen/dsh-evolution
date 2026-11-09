// @tier pre-tag
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { spawnTsx } from '../../test-support/tsx-launcher.ts'
import { resolveUnitAuthority } from '../src/unit-recovery.ts'

async function waitFor(path: string, timeoutMs: number): Promise<string> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try { return await readFile(path, 'utf8') } catch { await new Promise(resolve => setTimeout(resolve, 20)) }
  }
  throw new Error('timeout waiting for ' + path)
}

it('persists target-pending when the commit process is force-killed', { timeout: 60_000 }, async () => {
  const home = await tempRoot('dsh-unit-crash-')
  const core = new URL('../../evolution-merge/src/unit-protocol.ts', import.meta.url).href
  const ioUrl = new URL('../src/io.ts', import.meta.url).href
  const scriptPath = join(home, 'crash.mts')
  const pidPath = join(home, 'child.pid')
  await writeFile(scriptPath, `
import { writeFile } from 'node:fs/promises'
import { MergeUnitTransactions } from ${JSON.stringify(core)}
import { nodeEvolutionIo } from ${JSON.stringify(ioUrl)}
const tx = new MergeUnitTransactions({
  io: nodeEvolutionIo(), home: ${JSON.stringify(home)},
  backend: { async readSkill() { return 'old' }, async readSupportFile() { return null }, async commit() { await writeFile(${JSON.stringify(pidPath)}, String(process.pid)); await new Promise(() => { setInterval(() => {}, 1000) }) }, async restoreTarget() {}, async restoreSource() {} },
  claim: { async acquire() { return { async release() {} } } }, now: () => 1,
})
const p = await tx.prepare({ runId: 'run-1', pairKey: 'alpha', target: 'alpha', targetExists: true, sources: [], body: 'new', supportFiles: [], expectedTargetBody: 'old', expectedSourceBodies: [], origin: 'foreground', summary: 's' })
if (!p.ok) process.exit(2)
await tx.commit(p.prepared)
`)
  const child = spawnTsx(scriptPath)
  const pid = Number(await waitFor(pidPath, 40_000))
  process.kill(pid, 'SIGKILL')
  await new Promise<void>(resolve => child.once('exit', () => { resolve() }))
  const dir = join(home, 'merge', 'unit-journals')
  const files = await readdir(dir)
  const journal = JSON.parse(await readFile(join(dir, files[0]!), 'utf8')) as { unitId: string; phase: string }
  expect(journal.phase).toBe('target-pending')
  expect(await resolveUnitAuthority(nodeEvolutionIo(), home, journal.unitId, true)).toBe('unit')
})
