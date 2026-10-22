import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillLibrary } from '../evolution-core/lib/index.js'

const BODY = (name, extra = '') => '---\nname: ' + name + '\ndescription: concurrency probe\n---\n\n# ' + name + '\n' + extra
const root = await mkdtemp(join(tmpdir(), 'dsh-commit-concurrency-probe-'))
try {
  const lib = new SkillLibrary(root)
  await lib.create('target', BODY('target'), 'foreground')
  await lib.create('a', BODY('a'), 'foreground')
  await lib.create('b', BODY('b'), 'foreground')
  const target = await lib.read('target')
  const a = await lib.read('a')
  const b = await lib.read('b')
  const plan = (source, body, sourceBody) => ({
    target: 'target', targetExists: true, sources: [source], body, supportFiles: [],
    expectedTargetBody: target, expectedSourceBodies: [{ name: source, body: sourceBody }],
    origin: 'foreground', summary: 'concurrency probe',
  })
  const [one, two] = await Promise.all([
    lib.commitMerge(plan('a', BODY('target', '\nWIN-A\n'), a)),
    lib.commitMerge(plan('b', BODY('target', '\nWIN-B\n'), b)),
  ])
  const successes = [one, two].filter(result => result.ok).length
  if (successes !== 1) throw new Error('expected exactly one winner, got ' + successes)
  const afterTarget = await lib.read('target')
  const afterA = await lib.read('a')
  const afterB = await lib.read('b')
  const winnerA = String(afterTarget).includes('WIN-A')
  if (!winnerA && !String(afterTarget).includes('WIN-B')) throw new Error('target is neither winner body')
  const winnerSource = winnerA ? afterA : afterB
  const loserSource = winnerA ? afterB : afterA
  if (winnerSource !== null) throw new Error('winner source was not archived')
  if (loserSource === null) throw new Error('loser source was archived')
  console.log('concurrency probe ok: one winner, target intact, loser source preserved')
} finally {
  await rm(root, { recursive: true, force: true })
}
