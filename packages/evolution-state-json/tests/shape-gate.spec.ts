import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tempRoot } from '../../test-support/temp-home.ts'
import { mountStateStack } from '../../test-support/state-stack.ts'


describe('evolution-state-json state shape gate (G2.2, F-215)', () => {
  it.each([
    ['review-state.json', [], 's1'],
    ['curator-state.json', 42, null],
    ['pending-state.json', 'str', null],
    ['pending.json', [], null],
  ] as [string, unknown, string | null][])(
    'quarantines a valid-JSON but non-object %s as %s',
    async (file, value, sessionId) => {
      const root = await tempRoot('dsh-json-shape-')
      const ctx = await mountStateStack(root)
      const provider = ctx.evolutionStateStorage.provider('json')
      const io = ctx.evolutionIo.provider('node')
      const content = JSON.stringify(value)
      await io.writeText(join(root, file), content)
      const trigger = () => {
        switch (file) {
          case 'review-state.json': return provider.loadReviewState(sessionId as string)
          case 'curator-state.json': return provider.loadCuratorState()
          default: return provider.listPending()
        }
      }
      await expect(trigger()).rejects.toThrow(/not valid JSON/)
      // The corrupt bytes are preserved for operator rescue, never cleared.
      // V10-05 (P2-5): the copy is the FIXED name `<file>.corrupt` (at most
      // one per file — the old timestamped series grew on every read).
      const entries = await io.list(root)
      const corrupt = entries.find(name => name === `${file}.corrupt`)
      expect(corrupt).toBeDefined()
      expect(await io.readText(join(root, corrupt!))).toBe(content)
      expect(await io.readText(join(root, file))).toBe(content)
    },
  )

  it('a save into a wrong-shape record map rejects and leaves the file untouched', async () => {
    const root = await tempRoot('dsh-json-shape-save-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(root, 'review-state.json'), '[]')
    await expect(provider.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 }))
      .rejects.toThrow(/not valid JSON/)
    expect(await io.readText(join(root, 'review-state.json'))).toBe('[]')
  })

  it('V8-16: a value-level malformation quarantines (no bare .status TypeError) and preserves the bytes (0.3.46)', async () => {
    const root = await tempRoot('dsh-json-shape-value-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    const content = JSON.stringify({ broken: null })
    await io.writeText(join(root, 'pending-state.json'), content)
    await expect(provider.listPending()).rejects.toThrow(/record "broken"/)
    const corrupt = (await io.list(root)).find(name => name === 'pending-state.json.corrupt')
    expect(corrupt).toBeDefined()
    expect(await io.readText(join(root, corrupt!))).toBe(content)
    expect(await io.readText(join(root, 'pending-state.json'))).toBe(content)
  })

  it('loads a well-shaped record map normally', async () => {
    const root = await tempRoot('dsh-json-shape-ok-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    await provider.saveReviewState('s1', { turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 })
    expect(await provider.loadReviewState('s1')).toEqual({ turnsSinceMemory: 1, turnsSinceSkill: 0, lastTurn: 1 })
  })

  it('produces exactly one .corrupt copy and a non-nested message on a wrong shape (V4-06)', async () => {
    const root = await tempRoot('dsh-json-shape-single-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(root, 'review-state.json'), '[]')

    let message = ''
    try {
      await provider.loadReviewState('s1')
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toMatch(/not valid JSON/)
    expect(message).toMatch(/expected a plain JSON object/)
    // V4-06: a wrong-shape quarantine used to fall into the same function's
    // parse catch and quarantine AGAIN — two .corrupt copies and a message that
    // nests the previous quarantine text. It must appear exactly once.
    expect(message.split('not valid JSON')).toHaveLength(2)
    const entries = await io.list(root)
    const corrupt = entries.filter(name => name.startsWith('review-state.json.corrupt'))
    expect(corrupt).toHaveLength(1)
  })

  it('V10-05 (P2-5): reading a corrupt file twice yields exactly ONE fixed `.corrupt` copy', async () => {
    const root = await tempRoot('dsh-json-shape-bounded-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')
    await io.writeText(join(root, 'review-state.json'), '[]')
    // The old `.corrupt-<stamp>-<rand>` name minted a fresh copy on EVERY
    // read (review reads happen every turn — unbounded growth, no sweep). The
    // fixed name overwrite-commits: two reads, still exactly one copy.
    await expect(provider.loadReviewState('s1')).rejects.toThrow(/not valid JSON/)
    await expect(provider.loadReviewState('s1')).rejects.toThrow(/not valid JSON/)
    const entries = await io.list(root)
    expect(entries.filter(name => name.startsWith('review-state.json.corrupt'))).toEqual(['review-state.json.corrupt'])
    expect(await io.readText(join(root, 'review-state.json.corrupt'))).toBe('[]')
  })
})
