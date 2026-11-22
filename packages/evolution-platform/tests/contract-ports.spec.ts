// @tier fast
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../../scripts/gen-contract-ports.mjs', import.meta.url))

describe('generated platform ports', () => {
  it('is current with contract-ports.json', () => {
    const out = execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8' })
    expect(out).toContain('up to date')
  })
})
