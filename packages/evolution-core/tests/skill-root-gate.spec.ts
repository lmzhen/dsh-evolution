// @tier fast
import { describe, expect, it } from 'vitest'
import { SkillRootGate } from '../src/skill-root-gate.ts'

const sleep = async (ms: number): Promise<void> => await new Promise(resolve => setTimeout(resolve, ms))

describe('SkillRootGate', () => {
  it('admits shared holders concurrently', async () => {
    const gate = new SkillRootGate()
    let active = 0
    let max = 0
    const read = async (): Promise<void> => {
      active += 1
      max = Math.max(max, active)
      await sleep(15)
      active -= 1
    }
    await Promise.all([gate.read(read), gate.read(read)])
    expect(max).toBe(2)
    expect(gate.readerCount).toBe(0)
  })

  it('excludes a writer from active readers', async () => {
    const gate = new SkillRootGate()
    let readers = 0
    let writer = false
    let overlap = false
    const read = async (): Promise<void> => {
      readers += 1
      if (writer) overlap = true
      await sleep(20)
      readers -= 1
    }
    const write = async (): Promise<void> => {
      writer = true
      if (readers > 0) overlap = true
      await sleep(5)
      writer = false
    }
    await Promise.all([gate.read(read), gate.write(write)])
    expect(overlap).toBe(false)
  })

  it('excludes readers from an active writer', async () => {
    const gate = new SkillRootGate()
    let writer = false
    let readerSawWriter = false
    const write = gate.write(async () => {
      writer = true
      await sleep(20)
      writer = false
    })
    await sleep(1)
    const read = gate.read(async () => {
      if (writer) readerSawWriter = true
    })
    await Promise.all([write, read])
    expect(readerSawWriter).toBe(false)
  })

  it('does not leave observers behind', async () => {
    const gate = new SkillRootGate()
    await Promise.all([gate.read(async () => {}), gate.write(async () => {}), gate.read(async () => {})])
    expect(gate.readerCount).toBe(0)
    expect(gate.writerActive).toBe(false)
  })
})
