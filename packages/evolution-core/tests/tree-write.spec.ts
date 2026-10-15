// @tier pre-tag
/** G1/1.5 (S7-09): the typed critical section. Two properties matter and both are about the QUEUE, not the
 * type: work inside the section is serialized by the caller queue, and the release happens even when the
 * section throws (a leaked lock would take the whole control plane down, which is the failure the curator
 * mutex comment says the v15 draft suffered from). */
import { expect, it } from 'vitest'
import { withTreeWrite, type SnapshotView } from '../src/tree-write.ts'

const view = (names: readonly string[] = [], onWrite?: (name: string, content: string) => void): SnapshotView => ({
  names,
  read: async () => undefined,
  writeSkill: async (name, content) => { onWrite?.(name, content) },
  note: () => {},
})

it('G1/1.5: sections over one queue never overlap, and the release runs when the section throws', async () => {
  let depth = 0
  let maxDepth = 0
  const releases: string[] = []
  const queue = () => {
    const order: (() => void)[] = []
    let tail: Promise<void> = Promise.resolve()
    return async () => {
      const prev = tail
      let release!: () => void
      tail = new Promise<void>((resolve) => { release = resolve })
      await prev
      return () => { releases.push('r' + order.length); release() }
    }
  }
  const acquire = queue()
  const section = async (label: string, fail = false): Promise<void> =>
    await withTreeWrite(acquire, view(), async () => {
      depth += 1
      maxDepth = Math.max(maxDepth, depth)
      await new Promise((resolve) => setTimeout(resolve, 5))
      depth -= 1
      if (fail) throw new Error(label + ' failed')
    })
  const results = await Promise.allSettled([section('a'), section('b'), section('c', true), section('d')])
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'fulfilled'])
  expect(maxDepth).toBe(1)
  // Every section released, including the one that threw.
  expect(releases).toHaveLength(4)
})

it('G1/1.5: the view is the only write a section gets - it mutates through writeSkill', async () => {
  const written: string[] = []
  const acquire = async () => () => {}
  await withTreeWrite(acquire, view([], (name) => written.push(name)), async (v) => {
    await v.writeSkill('demo', 'body')
    v.note('one skill')
  })
  expect(written).toEqual(['demo'])
})
