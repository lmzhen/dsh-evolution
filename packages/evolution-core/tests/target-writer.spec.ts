// @tier fast
import { describe, expect, it } from 'vitest'
import type { EvolutionIoLike } from '../src/io.ts'
import { TargetWriter, type UnitTarget } from '../src/target-writer.ts'

function fakeIo(initial: Record<string, string> = {}): { io: EvolutionIoLike; files: Map<string, string>; writes: string[]; failOn: Set<string> } {
  const files = new Map(Object.entries(initial))
  const writes: string[] = []
  const failOn = new Set<string>()
  const io: EvolutionIoLike = {
    processScope: 'single-process',
    async readText(path) { return files.get(path) ?? null },
    async writeText(path, content) {
      if (failOn.has(path)) throw new Error('injected write failure: ' + path)
      writes.push(path)
      files.set(path, content)
    },
    async remove(path) { writes.push(path); files.delete(path) },
    async list() { return [...files.keys()] },
    async exists(path) { return files.has(path) },
    async rename(path, destination) { const value = files.get(path); files.delete(path); if (value !== undefined) files.set(destination, value) },
    async copy(path, destination) { const value = files.get(path); if (value !== undefined) files.set(destination, value) },
    async createTextIfAbsent(path, content) {
      if (files.has(path)) throw Object.assign(new Error('exists'), { code: 'EEXIST' })
      writes.push(path)
      files.set(path, content)
    },
    async transact(path, task) {
      const current = files.get(path) ?? null
      const next = await task(current)
      if (next === current) return
      if (failOn.has(path)) throw new Error('injected transaction failure: ' + path)
      writes.push(path)
      if (next === null) files.delete(path)
      else files.set(path, next)
    },
  }
  return { io, files, writes, failOn }
}

function target(path: string, expected: string | null, next: string | null): UnitTarget {
  return { path, expected, next }
}

describe('TargetWriter prepare / commit', () => {
  it('prepares every target without writing a byte', async () => {
    const { io, files, writes } = fakeIo({ a: 'A', b: 'B' })
    const kernel = new TargetWriter({ io })
    const prepared = await kernel.prepare([target('a', 'A', 'A2'), target('b', 'B', 'B2')])
    expect(prepared.ok).toBe(true)
    expect(writes).toEqual([])
    expect(files.get('a')).toBe('A')
    expect(files.get('b')).toBe('B')
  })

  it('refuses a stale plan before any write', async () => {
    const { io, writes } = fakeIo({ a: 'changed' })
    const kernel = new TargetWriter({ io })
    const result = await kernel.commit([target('a', 'A', 'A2')])
    expect(result.ok).toBe(false)
    expect(result.errors[0]?.code).toBe('cas-conflict')
    expect(writes).toEqual([])
  })

  it('commits a prepared unit and reports the written targets', async () => {
    const { io, files, writes } = fakeIo({ a: 'A', b: 'B' })
    const kernel = new TargetWriter({ io })
    const prepared = await kernel.prepare([target('a', 'A', 'A2'), target('b', 'B', 'B2')])
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const result = await kernel.commitPrepared(prepared.prepared)
    expect(result.ok).toBe(true)
    expect(result.changed).toEqual(['a', 'b'])
    expect(writes).toEqual(['a', 'b'])
    expect(files.get('a')).toBe('A2')
    expect(files.get('b')).toBe('B2')
  })

  it('compensates only the targets this unit wrote when a later write fails', async () => {
    const { io, files, failOn } = fakeIo({ a: 'A', b: 'B' })
    failOn.add('b')
    const kernel = new TargetWriter({ io })
    const prepared = await kernel.prepare([target('a', 'A', 'A2'), target('b', 'B', 'B2')])
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const result = await kernel.commitPrepared(prepared.prepared)
    expect(result.ok).toBe(false)
    expect(result.changed).toEqual(['a'])
    expect(files.get('a')).toBe('A')
    expect(files.get('b')).toBe('B')
  })
})
