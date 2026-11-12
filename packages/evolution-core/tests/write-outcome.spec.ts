// @tier fast
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeEvolutionIo, transactOutcome, type EvolutionIoLike } from '../src/io.ts'

/**
 * W9-commit-protocol §3.3: a durable write must distinguish "landed", "rejected" and "written but
 * durability unconfirmed". The last one is the case `transactIo` deliberately collapses into
 * success, so two-phase callers had no way to learn their follow-up step is unconfirmed.
 */

const dir = (): string => mkdtempSync(join(tmpdir(), 'outcome-'))

function backend(options: { writeError?: unknown; transactError?: unknown } = {}): EvolutionIoLike {
  const base = nodeEvolutionIo()
  return {
    ...base,
    ...(options.transactError === undefined ? {} : {
      transact: async () => { throw options.transactError },
    }),
    ...(options.writeError === undefined ? {} : {
      writeText: async () => { throw options.writeError },
    }),
  } as EvolutionIoLike
}

const committedWarning = (): Error => Object.assign(new Error('rename landed, directory fsync failed'), { committed: true })
const plainFailure = (): Error => Object.assign(new Error('permission denied'), { code: 'EACCES' })

describe('transactOutcome', () => {
  it('reports landed for a committed write', async () => {
    const path = join(dir(), 'x.json')
    await expect(transactOutcome(nodeEvolutionIo(), path, () => '{"a":1}')).resolves.toEqual({ kind: 'landed' })
  })

  it('reports unknown when the bytes landed but durability is unconfirmed', async () => {
    const path = join(dir(), 'x.json')
    const outcome = await transactOutcome(backend({ transactError: committedWarning() }), path, () => '{"a":1}')
    expect(outcome.kind).toBe('unknown')
    if (outcome.kind === 'unknown') expect(outcome.message).toMatch(/fsync/)
  })

  it('reports rejected with the backend code for a plain failure', async () => {
    const path = join(dir(), 'x.json')
    const outcome = await transactOutcome(backend({ transactError: plainFailure() }), path, () => '{"a":1}')
    expect(outcome).toMatchObject({ kind: 'rejected', code: 'EACCES' })
  })

  it('falls back to read/render/write when the backend has no transact', async () => {
    const path = join(dir(), 'x.json')
    const base = nodeEvolutionIo()
    const noTransact = { ...base, transact: undefined } as EvolutionIoLike
    await expect(transactOutcome(noTransact, path, () => '{"b":2}')).resolves.toEqual({ kind: 'landed' })
    await expect(base.readText(path)).resolves.toBe('{"b":2}')
  })

  it('treats a byte-identical render as landed without rewriting', async () => {
    const path = join(dir(), 'x.json')
    const base = nodeEvolutionIo()
    await base.writeText(path, '{"same":true}')
    let writes = 0
    const counting = { ...base, transact: undefined, writeText: async (p: string, text: string) => { writes += 1; await base.writeText(p, text) } } as EvolutionIoLike
    await expect(transactOutcome(counting, path, () => '{"same":true}')).resolves.toEqual({ kind: 'landed' })
    expect(writes).toBe(0)
  })

  it('reports rejected when the fallback write fails', async () => {
    const path = join(dir(), 'x.json')
    const base = nodeEvolutionIo()
    const failing = { ...base, transact: undefined, writeText: async () => { throw plainFailure() } } as EvolutionIoLike
    await expect(transactOutcome(failing, path, () => '{"c":3}')).resolves.toMatchObject({ kind: 'rejected', code: 'EACCES' })
  })
})
