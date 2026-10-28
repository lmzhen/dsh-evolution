// @tier pre-tag
import { expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contentHash, DEFAULT_SKILL_LIMITS, loadVersions, nodeEvolutionIo, planExtract, planUnitUndoAcross, readExternalSupport, SkillLibrary, type OwnerDecision } from '@deepseek-ai/dsh-evolution-core'

const NL = String.fromCharCode(10)
const COVERED: OwnerDecision = {
  mode: 'covered',
  name: 'target',
  triggerCovers: true,
  outcomeCovers: true,
  reason: 'target covers the capability',
}

function skill(name: string, body: string): string {
  return ['---', 'name: ' + name, 'description: ' + name + ' fixture.', '---', '', body].join(NL)
}

function sourceBody(withSupport = false): string {
  return [
    '# Source',
    '',
    'Intro.',
    '',
    '## Details',
    '',
    withSupport ? 'See references/shared.md and references/exclusive.md for details' : 'A reusable detail line.',
    '',
    '## Usage',
    '',
    withSupport ? 'See references/shared.md for details' : 'Use it with care.',
  ].join(NL)
}

async function makeLib(): Promise<{ root: string; lib: SkillLibrary }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evo-extract-kernel-'))
  const lib = new SkillLibrary(root, nodeEvolutionIo(), { ...DEFAULT_SKILL_LIMITS, versionKeep: 20 })
  await lib.create('source', skill('source', sourceBody(false)), 'foreground')
  await lib.create('target', skill('target', '# Target' + NL + NL + 'Existing.'), 'foreground')
  return { root, lib }
}

it('writes source residual and target addition in one unit', async () => {
  const { root, lib } = await makeLib()
  try {
    const plan = planExtract({
      body: sourceBody(false),
      sourceName: 'source',
      targetName: 'target',
      targetExists: true,
      outcome: 'extract',
      owner: COVERED,
      requests: [{ heading: 'Details' }],
      sourceFiles: [],
      targetFiles: [],
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const result = await lib.extract(plan.plan, 'foreground')
    expect(result.ok).toBe(true)
    const source = await readFile(join(root, 'source', 'SKILL.md'), 'utf8')
    const target = await readFile(join(root, 'target', 'SKILL.md'), 'utf8')
    expect(source).toContain('This capability now lives in target')
    expect(source).toContain('## Usage')
    expect(source).not.toContain('A reusable detail line.')
    expect(target.match(/^## Details$/gm)?.length).toBe(1)
    expect(target).toContain('A reusable detail line.')
    expect(target).toContain('Existing.')
    const io = nodeEvolutionIo()
    const sourceVersions = await loadVersions(root, io, 'source')
    const targetVersions = await loadVersions(root, io, 'target')
    const sourceExtract = sourceVersions.find(version => version.action === 'extract')
    const targetExtract = targetVersions.find(version => version.action === 'extract')
    expect(sourceExtract?.unitId).toBe(targetExtract?.unitId)
    expect(targetExtract?.unitHead?.sources).toEqual([{ skill: 'source' }, { skill: 'target' }])
    const undo = planUnitUndoAcross([
      { skill: 'source', entries: sourceVersions.filter(version => version.unitId === sourceExtract?.unitId), status: 'live' },
      { skill: 'target', entries: targetVersions.filter(version => version.unitId === targetExtract?.unitId), status: 'live' },
    ])
    expect(undo.refusals).toEqual([])
    expect(new Set(undo.ops.map(op => op.skill))).toEqual(new Set(['source', 'target']))
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

it('copies shared support, deletes exclusive support, and keeps the parent reference', async () => {
  const { root, lib } = await makeLib()
  try {
    await lib.writeSupportFile('source', 'references/shared.md', '# shared', 'foreground')
    await lib.writeSupportFile('source', 'references/exclusive.md', '# exclusive', 'foreground')
    const plan = planExtract({
      body: sourceBody(true),
      sourceName: 'source',
      targetName: 'target',
      targetExists: true,
      outcome: 'mixed',
      owner: COVERED,
      requests: [{ heading: 'Details' }],
      sourceFiles: ['references/shared.md', 'references/exclusive.md'],
      targetFiles: [],
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const result = await lib.extract(plan.plan, 'foreground')
    expect(result.ok).toBe(true)
    expect(await readFile(join(root, 'target', 'references', 'shared.md'), 'utf8')).toBe('# shared')
    expect(await readFile(join(root, 'target', 'references', 'exclusive.md'), 'utf8')).toBe('# exclusive')
    expect(await readFile(join(root, 'source', 'references', 'shared.md'), 'utf8')).toBe('# shared')
    await expect(readFile(join(root, 'source', 'references', 'exclusive.md'), 'utf8')).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

it('refuses owner-gap without touching either body', async () => {
  const { root, lib } = await makeLib()
  try {
    const plan = planExtract({
      body: sourceBody(false),
      sourceName: 'source',
      targetName: 'target',
      targetExists: true,
      outcome: 'owner-gap',
      owner: { mode: 'owner-gap', neededOwner: 'release-owner', triggerCovers: true, outcomeCovers: false, reason: 'no owner' },
      requests: [{ heading: 'Details' }],
      sourceFiles: [],
      targetFiles: [],
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const beforeSource = await readFile(join(root, 'source', 'SKILL.md'), 'utf8')
    const beforeTarget = await readFile(join(root, 'target', 'SKILL.md'), 'utf8')
    const result = await lib.extract(plan.plan, 'foreground')
    expect(result.ok).toBe(false)
    expect(await readFile(join(root, 'source', 'SKILL.md'), 'utf8')).toBe(beforeSource)
    expect(await readFile(join(root, 'target', 'SKILL.md'), 'utf8')).toBe(beforeTarget)
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

it('refuses a pinned target before writing either body', async () => {
  const { root, lib } = await makeLib()
  try {
    await lib.setPinned('target', true, 'foreground')
    const plan = planExtract({
      body: sourceBody(false),
      sourceName: 'source',
      targetName: 'target',
      targetExists: true,
      outcome: 'extract',
      owner: COVERED,
      requests: [{ heading: 'Details' }],
      sourceFiles: [],
      targetFiles: [],
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const beforeSource = await readFile(join(root, 'source', 'SKILL.md'), 'utf8')
    const beforeTarget = await readFile(join(root, 'target', 'SKILL.md'), 'utf8')
    const result = await lib.extract(plan.plan, 'background_review')
    expect(result.ok).toBe(false)
    expect(await readFile(join(root, 'source', 'SKILL.md'), 'utf8')).toBe(beforeSource)
    expect(await readFile(join(root, 'target', 'SKILL.md'), 'utf8')).toBe(beforeTarget)
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

it('rolls back a copy when the target body write fails', async () => {
  const { root, lib } = await makeLib()
  try {
    await lib.writeSupportFile('source', 'references/shared.md', '# shared', 'foreground')
    const io = nodeEvolutionIo()
    const original = io.transact
    io.transact = async (path, task) => {
      if (path.endsWith(join('target', 'SKILL.md'))) throw new Error('injected target body failure')
      if (original === undefined) throw new Error('missing transact')
      return original.call(io, path, task)
    }
    const failing = new SkillLibrary(root, io, { ...DEFAULT_SKILL_LIMITS, versionKeep: 20 })
    const plan = planExtract({
      body: sourceBody(true),
      sourceName: 'source',
      targetName: 'target',
      targetExists: true,
      outcome: 'mixed',
      owner: COVERED,
      requests: [{ heading: 'Details' }],
      sourceFiles: ['references/shared.md', 'references/exclusive.md'],
      targetFiles: [],
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const beforeSource = await readFile(join(root, 'source', 'SKILL.md'), 'utf8')
    const result = await failing.extract(plan.plan, 'foreground')
    expect(result.ok).toBe(false)
    expect(await readFile(join(root, 'source', 'SKILL.md'), 'utf8')).toBe(beforeSource)
    await expect(readFile(join(root, 'target', 'references', 'shared.md'), 'utf8')).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

it('refuses when source/target drift after the plan was computed', async () => {
  const { root, lib } = await makeLib()
  try {
    const sourceMd = await readFile(join(root, 'source', 'SKILL.md'), 'utf8')
    const targetMd = await readFile(join(root, 'target', 'SKILL.md'), 'utf8')
    const plan = planExtract({
      body: sourceBody(false),
      sourceName: 'source',
      targetName: 'target',
      targetExists: true,
      outcome: 'extract',
      owner: COVERED,
      requests: [{ heading: 'Details' }],
      sourceFiles: [],
      targetFiles: [],
      anchors: { sourceMdSha256: contentHash(sourceMd), targetMdSha256: contentHash(targetMd) },
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    await lib.update('target', skill('target', '# Target' + NL + NL + 'Changed.'), 'foreground')
    const result = await lib.extract(plan.plan, 'foreground')
    expect(result.ok).toBe(false)
    expect(await readFile(join(root, 'source', 'SKILL.md'), 'utf8')).toBe(sourceMd)
    expect(await readFile(join(root, 'target', 'SKILL.md'), 'utf8')).toContain('Changed.')
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

it('copies bounded external support to the target without deleting the source', async () => {
  const { root, lib } = await makeLib()
  try {
    await mkdir(join(root, 'shared', 'scripts'), { recursive: true })
    await writeFile(join(root, 'shared', 'scripts', 'run.mjs'), 'console.log(1)' + NL, 'utf8')
    const body = ['# Source', '', 'Intro.', '', '## Details', '', 'See ../shared/scripts/run.mjs.', '', '## Usage', '', 'Use it.'].join(NL)
    await lib.update('source', skill('source', body), 'foreground')
    const external = await readExternalSupport(body, join(root, 'source'), root, [])
    expect(external.ok).toBe(true)
    if (!external.ok) return
    const plan = planExtract({
      body,
      sourceName: 'source',
      targetName: 'target',
      targetExists: true,
      outcome: 'extract',
      owner: COVERED,
      requests: [{ heading: 'Details' }],
      sourceFiles: [],
      targetFiles: [],
      external: external.files,
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const result = await lib.extract(plan.plan, 'foreground')
    expect(result.ok, result.message).toBe(true)
    const target = await readFile(join(root, 'target', 'SKILL.md'), 'utf8')
    expect(target).toContain('scripts/run.mjs')
    expect(await readFile(join(root, 'target', 'scripts', 'run.mjs'), 'utf8')).toContain('external source:')
    expect(await readFile(join(root, 'shared', 'scripts', 'run.mjs'), 'utf8')).toBe('console.log(1)' + NL)
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
