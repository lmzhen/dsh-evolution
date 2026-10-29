// @tier fast
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { SkillLibrary, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'

it('records one mechanical hard-cap event on a rejected create', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-hard-cap-'))
  const root = join(home, 'skills')
  try {
    const lib = new SkillLibrary(root, nodeEvolutionIo())
    const body = 'x'.repeat(100_001)
    const result = await lib.create('too-big', '---\nname: too-big\ndescription: too big.\n---\n\n' + body, 'foreground')
    expect(result.ok).toBe(false)
    const raw = await readFile(join(home, 'evolution', 'events.json'), 'utf8')
    const log = JSON.parse(raw) as { events: Array<Record<string, unknown>> }
    const hit = log.events.find(event => event.type === 'hard-cap')
    expect(hit).toMatchObject({ target: 'too-big', source: 'create', supportFiles: null, restructureRounds: 0 })
    expect(hit?.bodyChars).toBeGreaterThan(100_000)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
