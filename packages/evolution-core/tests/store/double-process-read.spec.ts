// @tier pre-tag
import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { HomeFence } from '../../src/home-fence.ts'
import { nodeEvolutionIo } from '../../src/io.ts'
import { StoreKernel } from '../../src/store/store-kernel.ts'
import { tempRoot } from '../../../test-support/temp-home.ts'

const libUrl = (file: string): string => pathToFileURL(fileURLToPath(new URL('../../lib/' + file, import.meta.url))).href

function readInChild(home: string): Promise<string> {
  const script = [
    'import { StoreKernel, nodeEvolutionIo } from ' + JSON.stringify(libUrl('index.js')) + ';',
    'const kernel = new StoreKernel({ io: nodeEvolutionIo(), home: process.argv[1] });',
    'const snapshot = await kernel.query(["state"]);',
    'process.stdout.write(JSON.stringify(snapshot.domains.state));',
  ].join('\n')
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, home], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error('child read failed: ' + stderr)))
  })
}

describe('lock-free read across processes', () => {
  it('reads the snapshot while another process holds the home fence', async () => {
    const home = await tempRoot('dsh-cross-process-read-')
    const io = nodeEvolutionIo()
    const fence = new HomeFence({ home })
    const kernel = new StoreKernel({ io, home, fence })
    await kernel.bootstrap({ state: { version: 7 } })
    const seen = await fence.run(async () => await readInChild(home))
    expect(JSON.parse(seen)).toEqual({ version: 7 })
  }, 60_000)
})
