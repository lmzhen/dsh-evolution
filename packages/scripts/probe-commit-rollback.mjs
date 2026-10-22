import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillLibrary } from '../evolution-core/lib/index.js'

const BODY = (name, extra = '') => '---\nname: ' + name + '\ndescription: rollback probe\n---\n\n# ' + name + '\n\nBody ' + name + '.' + extra
const root = await mkdtemp(join(tmpdir(), 'dsh-commit-rollback-probe-'))
try {
  const lib = new SkillLibrary(root)
  await lib.create('target', BODY('target'), 'foreground')
  await lib.create('src', BODY('src'), 'foreground')
  const beforeTarget = await lib.read('target')
  const beforeSource = await lib.read('src')
  const original = lib.archive.bind(lib)
  lib.archive = async (name, options, origin) => name === 'src' ? { ok: false, message: 'injected archive failure' } : original(name, options, origin)
  const result = await lib.commitMerge({
    target: 'target',
    targetExists: true,
    sources: ['src'],
    body: BODY('target', '\nmerged\n'),
    supportFiles: [],
    expectedTargetBody: beforeTarget,
    expectedSourceBodies: [{ name: 'src', body: beforeSource }],
    origin: 'foreground',
    summary: 'rollback probe',
  })
  const afterTarget = await lib.read('target')
  const afterSource = await lib.read('src')
  if (result.ok) throw new Error('commit should fail')
  if (!String(result.message).includes('injected archive failure')) throw new Error('failure message lost: ' + result.message)
  if (afterTarget !== beforeTarget) throw new Error('target was not rolled back')
  if (afterSource !== beforeSource) throw new Error('source was not preserved')
  console.log('rollback probe ok: target restored, source preserved')
} finally {
  await rm(root, { recursive: true, force: true })
}
