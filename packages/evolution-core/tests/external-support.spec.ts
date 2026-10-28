// @tier fast
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { planExtract, readExternalSupport } from '@deepseek-ai/dsh-evolution-core'

it('copies an external file under the allowed root and annotates provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-external-support-'))
  try {
    await mkdir(join(root, 'source'), { recursive: true })
    await mkdir(join(root, 'shared', 'scripts'), { recursive: true })
    await writeFile(join(root, 'shared', 'scripts', 'run.mjs'), 'console.log(1)' + String.fromCharCode(10), 'utf8')
    const body = ['# Demo', '', '## Details', '', 'See ../shared/scripts/run.mjs.', '', '## Usage', '', 'Use it.'].join(String.fromCharCode(10))
    const external = await readExternalSupport(body, join(root, 'source'), root, [])
    expect(external.ok, external.ok ? 'ok' : external.message).toBe(true)
    if (!external.ok) return
    expect(external.files[0]?.targetPath).toBe('scripts/run.mjs')
    expect(external.files[0]?.content).toContain('external source:')
    const plan = planExtract({
      body,
      sourceName: 'source',
      targetName: 'target',
      targetExists: true,
      outcome: 'extract',
      owner: { mode: 'covered', name: 'target', triggerCovers: true, outcomeCovers: true, reason: 'explicit' },
      requests: [{ heading: 'Details' }],
      sourceFiles: [],
      targetFiles: [],
      external: external.files,
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.plan.support.external[0]?.to).toBe('scripts/run.mjs')
    expect(plan.plan.parts[0]?.movedText).toContain('scripts/run.mjs')
    expect(plan.plan.parts[0]?.movedText).not.toContain('../shared')
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
