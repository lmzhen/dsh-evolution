// @tier fast
import { expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
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

it('fails closed when the authority lock cannot be acquired', async () => {
  const root = await tempRoot('dsh-skill-authority-fail-closed-')
  const lock = { async acquire() { throw new Error('skill-store: no authority mutationLock was supplied; refusing an unfenced production write') } }
  const ctx = { emit() {}, get(name: string) { return name === 'evolutionMutationAuthority' ? { mutationLock: lock } : undefined } }
  const lib = newSkillLibrary({ config: { root }, io: nodeEvolutionIo(), ctx, authority: authorityFrom({ origin: 'foreground' }) })
  await expect(lib.create('must-not-write', skill('must-not-write'), 'foreground')).rejects.toThrow('refusing an unfenced production write')
  expect(await nodeEvolutionIo().exists(root + '/must-not-write/SKILL.md')).toBe(false)
})

it('fails closed in a production process without an authority', async () => {
  const root = await tempRoot('dsh-skill-authority-absent-')
  const code = [
    "import { newSkillLibrary } from './packages/evolution/evolution-core/src/skill-store.ts'",
    "import { nodeEvolutionIo } from './packages/evolution/evolution-core/src/io.ts'",
    "import { authorityFrom } from './packages/evolution/evolution-core/src/write-authority.ts'",
    "const lib = newSkillLibrary({ config: { root: process.argv[1] }, io: nodeEvolutionIo(), authority: authorityFrom({ origin: 'foreground' }) })",
    "const body = '---\\nname: no-authority\\ndescription: Production fence check for a skill with no authority.\\n---\\nbody\\n'",
    "lib.create('no-authority', body, 'foreground').then(() => process.exit(0), error => { console.error(String(error.message)); process.exit(3) })",
  ].join(String.fromCharCode(10))
  const result = await promisify(execFile)(process.execPath, ['--import', 'tsx/esm', '-e', code, root], {
    cwd: fileURLToPath(new URL('../../../..', import.meta.url)),
    env: { ...process.env, VITEST: '', NODE_ENV: 'production' },
    encoding: 'utf8',
  }).then(() => ({ code: 0, stderr: '' }), (error: unknown) => error as { code?: number; stderr?: string })
  expect(result.code).toBe(3)
  expect(result.stderr).toContain('refusing an unfenced production write')
  expect(await nodeEvolutionIo().exists(root + '/no-authority/SKILL.md')).toBe(false)
}, 30_000)
