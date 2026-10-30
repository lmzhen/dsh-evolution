// @tier pre-tag
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { MutationUnit } from '../src/mutation-unit.ts'
import { unitJournalPort, unitSnapshotPort } from '../src/mutation-storage-adapter.ts'

async function waitFor(path: string, timeoutMs: number): Promise<string> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try { return await readFile(path, 'utf8') } catch { await new Promise(resolve => setTimeout(resolve, 20)) }
  }
  throw new Error('timeout waiting for ' + path)
}

it('recovers a MutationUnit after the process is killed between ops', async () => {
  const home = await tempRoot('dsh-mutation-crash-')
  const skills = join(home, 'skills')
  const source = join(skills, 'source', 'SKILL.md')
  const target = join(skills, 'target', 'SKILL.md')
  await mkdir(join(skills, 'source'), { recursive: true })
  await mkdir(join(skills, 'target'), { recursive: true })
  await writeFile(source, 'old-source', 'utf8')
  await writeFile(target, 'old-target', 'utf8')
  const unitUrl = new URL('../src/mutation-unit.ts', import.meta.url).href
  const ioUrl = new URL('../src/io.ts', import.meta.url).href
  const adapterUrl = new URL('../src/mutation-storage-adapter.ts', import.meta.url).href
  const scriptPath = join(home, 'crash.mts')
  const pidPath = join(home, 'child.pid')
  await writeFile(scriptPath, `
import { writeFile } from 'node:fs/promises'
import { MutationUnit } from ${JSON.stringify(unitUrl)}
import { nodeEvolutionIo } from ${JSON.stringify(ioUrl)}
import { unitJournalPort, unitSnapshotPort } from ${JSON.stringify(adapterUrl)}
const home = ${JSON.stringify(home)}
const base = nodeEvolutionIo()
const io = { ...base, async transact(path, task) {
  if (path.replaceAll('\\\\', '/').endsWith('target/SKILL.md')) { await writeFile(${JSON.stringify(pidPath)}, String(process.pid)); await new Promise(() => { setInterval(() => {}, 1000) }) }
  return base.transact(path, task)
} }
const unit = new MutationUnit({ io, limits: { maxSkillFileBytes: 100000, maxSkillContentChars: 100000 }, snapshots: unitSnapshotPort(io, home), journal: unitJournalPort(io, home), now: () => 1 })
const result = await unit.apply({ name: 'source', roots: [{ name: 'source', protection: 'write' }], rootDirs: { source: ${JSON.stringify(skills)} }, ops: [
  { kind: 'write', target: ${JSON.stringify(source)}, content: 'new-source' },
  { kind: 'write', target: ${JSON.stringify(target)}, content: 'new-target' },
], origin: 'foreground', auditAction: 'extract', auditSummary: 'crash', eventAction: 'extract', unitId: 'crash-unit' })
if (!result.ok) process.exit(2)
`, 'utf8')
  const tsx = process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
  const child = spawn(join(process.cwd(), 'node_modules', '.bin', tsx), [scriptPath], { shell: true, stdio: 'ignore' })
  const pid = Number(await waitFor(pidPath, 20_000))
  process.kill(pid, 'SIGKILL')
  await new Promise<void>(resolve => child.once('exit', () => { resolve() }))

  const io = nodeEvolutionIo()
  const recovery = new MutationUnit({ io, limits: { maxSkillFileBytes: 100000, maxSkillContentChars: 100000 }, snapshots: unitSnapshotPort(io, home), journal: unitJournalPort(io, home) })
  const results = await recovery.recoverPrepared()
  expect(results.some(result => result.ok)).toBe(true)
  expect(await readFile(source, 'utf8')).toBe('old-source')
  expect(await readFile(target, 'utf8')).toBe('old-target')
}, 30_000)
