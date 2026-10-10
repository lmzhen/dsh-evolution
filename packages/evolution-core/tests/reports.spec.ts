import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { nodeEvolutionIo, sweepReports } from '../src/index.ts'
import type { EvolutionIoLike } from '../src/index.ts'

const roots: string[] = []
async function dir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-reports-sweep-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })))
})
const report = (startedAt: number): string => JSON.stringify({ startedAt: new Date(startedAt).toISOString(), verdict: 'ok' })

describe('core report retention sweep (S2: one sweep for every kind)', () => {
  // P2-7 (review): this case writes ~120 files through the real node io; under a
  // concurrent 7-spec run it sat on the 5s default and went red while passing in 930ms
  // alone. Give it the headroom the work actually needs.
  it('keeps each bucket window independently and prunes the paired .md digest', { timeout: 20_000 }, async () => {
    const root = await dir()
    const io = nodeEvolutionIo()
    const base = Date.now() - 1_000_000
    for (let i = 0; i < 25; i++) {
      await writeFile(join(root, `curator-${i}.json`), report(base + i), 'utf8')
      await writeFile(join(root, `curator-${i}.md`), 'digest', 'utf8')
    }
    for (let i = 0; i < 12; i++) await writeFile(join(root, `curator-error-${i}.json`), JSON.stringify({ at: new Date(base + i).toISOString() }), 'utf8')
    for (let i = 0; i < 25; i++) await writeFile(join(root, `maintain-${i}.json`), report(base + i), 'utf8')
    await writeFile(join(root, 'unrelated.txt'), 'kept', 'utf8')
    await sweepReports({
      io,
      dir: root,
      buckets: [{ prefix: 'curator-error-', keep: 10 }, { prefix: 'curator-', keep: 20 }, { prefix: 'maintain-', keep: 20 }],
      owner: 'test',
    })
    const names = await readdir(root)
    expect(names.filter(name => /^curator-\d+\.json$/.test(name))).toHaveLength(20)
    expect(names.filter(name => /^curator-error-/.test(name))).toHaveLength(10)
    expect(names.filter(name => /^maintain-/.test(name))).toHaveLength(20)
    expect(names, 'an unrelated file is never touched').toContain('unrelated.txt')
    expect(names).not.toContain('curator-4.json')
    expect(names).toContain('curator-24.json')
    expect(names, 'the pruned report digest goes with it').not.toContain('curator-4.md')
    expect(names).toContain('curator-24.md')
  })

  it('prunes a curator-shaped fixture exactly like the curator own sweep did (S2 parity)', async () => {
    const root = await dir()
    const io = nodeEvolutionIo()
    for (let i = 0; i < 25; i++) {
      const startedAt = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()
      await writeFile(join(root, `curator-seed-${i}.json`), JSON.stringify({ schemaVersion: 1, runId: `seed-${i}`, startedAt, finishedAt: startedAt }), 'utf8')
    }
    await writeFile(join(root, 'curator-corrupt.json'), '{not json', 'utf8')
    const newest = new Date(Date.UTC(2026, 0, 2)).toISOString()
    await writeFile(join(root, 'curator-real.json'), JSON.stringify({ runId: 'real', startedAt: newest }), 'utf8')
    await sweepReports({
      io,
      dir: root,
      buckets: [{ prefix: 'curator-error-', keep: 10 }, { prefix: 'curator-', keep: 20 }],
      owner: 'evolution-curator',
    })
    const names = (await readdir(root)).filter(name => name.endsWith('.json')).sort()
    // 20 kept + the corrupt one retention refuses to classify.
    expect(names).toHaveLength(21)
    expect(names).toContain('curator-corrupt.json')
    expect(names).toContain('curator-real.json')
    expect(names).not.toContain('curator-seed-0.json')
  })

  it('an UNLISTABLE directory deletes nothing and says so', async () => {
    const messages: string[] = []
    const io: EvolutionIoLike = {
      readText: async () => null,
      writeText: async () => {},
      remove: async () => { throw new Error('must not be called') },
      list: async () => { throw new Error('EACCES') },
      exists: async () => true,
      rename: async () => {},
      copy: async () => {},
    }
    await sweepReports({ io, dir: '/nowhere', buckets: [{ prefix: 'curator-', keep: 1 }], owner: 'test', warn: message => messages.push(message) })
    expect(messages.join('\n')).toContain('report retention skipped')
    expect(messages.join('\n')).toContain('EACCES')
  })

  it('a report with no usable timestamp is KEPT and said out loud once (never delete what cannot be ordered)', async () => {
    const messages: string[] = []
    const removed: string[] = []
    const files = ['curator-old.json', 'curator-new.json']
    const io: EvolutionIoLike = {
      readText: async (path: string) => (files.includes(path.split(/[\\/]/).pop() ?? '') ? '{}' : null),
      writeText: async () => {},
      remove: async (path: string) => { removed.push(path) },
      list: async () => files,
      exists: async () => true,
      rename: async () => {},
      copy: async () => {},
    }
    await sweepReports({ io, dir: '/reports', buckets: [{ prefix: 'curator-', keep: 1 }], owner: 'test', warn: message => messages.push(message) })
    expect(removed, 'nothing orderable → nothing deleted').toEqual([])
    expect(messages.filter(message => message.includes('no usable timestamp'))).toHaveLength(1)
  })

  it('reads a report it cannot parse as unorderable, not as the oldest', async () => {
    const root = await dir()
    const io = nodeEvolutionIo()
    await writeFile(join(root, 'curator-broken.json'), '{not json', 'utf8')
    await sweepReports({ io, dir: root, buckets: [{ prefix: 'curator-', keep: 0 }], owner: 'test' })
    expect(await readdir(root)).toContain('curator-broken.json')
  })
})
