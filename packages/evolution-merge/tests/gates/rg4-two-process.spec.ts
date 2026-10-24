// @tier pre-tag
import { spawn } from 'node:child_process'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { tempRoot } from '../../../test-support/temp-home.ts'

it('has exactly one winner between two real processes', async () => {
  const home = await tempRoot('dsh-rg4-two-')
  const ioUrl = new URL('../../../evolution-core/src/io.ts', import.meta.url).href
  const lockUrl = new URL('../../../evolution-core/src/tree-lock.ts', import.meta.url).href
  const script = join(home, 'contend.mts')
  await writeFile(script, `
import { writeFile, mkdir } from 'node:fs/promises'
import { nodeEvolutionIo } from ${JSON.stringify(ioUrl)}
import { acquireTreeWriteLock } from ${JSON.stringify(lockUrl)}
import { join } from 'node:path'
const home = process.argv[2]
const r = await acquireTreeWriteLock({ io: nodeEvolutionIo(), home, waitMs: 0 })
if (!r.ok) process.exit(3)
await mkdir(join(home, 'winners'), { recursive: true })
await writeFile(join(home, 'winners', String(process.pid)), 'win')
await new Promise(resolve => setTimeout(resolve, 2000))
await r.lock.release()
`)
  const bin = join(process.cwd(), 'node_modules', '.bin', 'tsx.cmd')
  const child = () => new Promise<number>((resolve) => { const c = spawn(bin, [script, home], { shell: true, stdio: 'ignore' }); c.once('exit', code => resolve(code ?? 1)) })
  const first = child()
  for (let i = 0; i < 100; i += 1) { if ((await readdir(join(home, 'winners')).catch(() => [])).length > 0) break; await new Promise(resolve => setTimeout(resolve, 25)) }
  const second = child()
  const [a, b] = await Promise.all([first, second])
  const winners = await readdir(join(home, 'winners')).catch(() => [])
  expect(winners).toHaveLength(1)
  expect([a, b].sort()).toEqual([0, 3])
})
