import { expect, it } from 'vitest'
import { newSkillLibrary } from '../src/skill-store.ts'
import { nodeEvolutionIo } from '../src/io.ts'
import { authorityFrom } from '../src/write-authority.ts'
import { tempRoot } from '../../test-support/temp-home.ts'

const skill = (name: string) => '---' + String.fromCharCode(10) + 'name: ' + name + String.fromCharCode(10) + 'description: Test authority lock wiring with a unique body.' + String.fromCharCode(10) + '---' + String.fromCharCode(10) + String.fromCharCode(10) + '# ' + name + String.fromCharCode(10)

it('newSkillLibrary auto-detects evolutionMutationAuthority from ctx', async () => {
  const root = await tempRoot('dsh-skill-authority-')
  let acquired = 0
  const lock = { async acquire() { acquired += 1; return { async release() {} } } }
  const ctx = { emit() {}, get(name: string) { return name === 'evolutionMutationAuthority' ? { mutationLock: lock } : undefined } }
  const lib = newSkillLibrary({ config: { root }, io: nodeEvolutionIo(), ctx, authority: authorityFrom({ origin: 'foreground' }) })
  const created = await lib.create('auto-lock', skill('auto-lock'), 'foreground')
  expect(created.ok).toBe(true)
  expect(acquired).toBeGreaterThan(0)
})
