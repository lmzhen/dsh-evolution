import { expect, it } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonState } from '@deepseek-ai/dsh-evolution-core'

it('JsonState deep-merges nested defaults with persisted state', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-jsonstate-'))
  const env = { DSH_HOME: home } as NodeJS.ProcessEnv

  const initial = {
    counters: { runs: 0, archived: 0 },
    flags: { enabled: true },
    label: 'state',
  }
  const store = new JsonState<typeof initial>('probe.json', initial, env)
  const evoDir = join(home, 'evolution')
  await mkdir(evoDir, { recursive: true })

  // Simulate a persisted file that adds a NEW nested key under an existing
  // object and changes a sibling — the shallow merge would drop 'enabled'.
  await writeFile(
    join(evoDir, 'probe.json'),
    JSON.stringify({ counters: { runs: 7, extras: true }, label: 'updated' }),
    'utf8',
  )
  await store.reload()

  const merged = store.get()
  // Nested object merges: existing default key preserved, persisted key wins.
  expect(merged.counters).toEqual({ runs: 7, archived: 0, extras: true })
  // Flat default with no persisted counterpart is preserved.
  expect(merged.flags.enabled).toBe(true)
  // Primitive on-disk value wins.
  expect(merged.label).toBe('updated')

  await rm(home, { recursive: true, force: true })
})

it('JsonState keeps arrays and primitive overrides opaque', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-jsonstate2-'))
  const env = { DSH_HOME: home } as NodeJS.ProcessEnv

  const initial = { tags: ['a', 'b'], val: 1 }
  const store = new JsonState<typeof initial>('probe2.json', initial, env)
  const evoDir = join(home, 'evolution')
  await mkdir(evoDir, { recursive: true })
  await writeFile(join(evoDir, 'probe2.json'), JSON.stringify({ tags: ['x'], val: 9 }), 'utf8')
  await store.reload()

  // Arrays are opaque: the on-disk array replaces the default wholesale.
  expect(store.get().tags).toEqual(['x'])
  expect(store.get().val).toBe(9)

  await rm(home, { recursive: true, force: true })
})
