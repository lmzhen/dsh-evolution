/** G3a-2/3/4 端到端：undoUnit 必须整单元回滚（零写预检 + 四分量），并守住两条硬判据。 */
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionCurator from '../src/index.ts'
import { newestUnitId } from '../src/unit-undo-plan.ts'

const stamp = String.fromCharCode(10)
const bodyWithExtra = ['---', 'name: u-skill', 'description: u-skill body', '---', '', '## Extra', 'extra content', ''].join(stamp)

const setup = async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-undo-unit-'))
  process.env.DSH_HOME = home
  const ctx = new Context()
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  const curator = new EvolutionCurator(ctx, { autoStart: false })
  const lib = curator.skills
  await lib.create('u-skill', bodyWithExtra, 'foreground')
  return { home, curator, lib, file: join(home, 'skills', 'u-skill', 'references', 'x.md') }
}

it('R-G3a-2：一次 undoUnit 把整单元回滚 —— 本单元创建的文件消失、正文回到搬移前', async () => {
  const { home, curator, lib } = await setup()
  try {
    const before = await lib.read('u-skill')
    const moved = await lib.restructure('u-skill', [{ heading: 'Extra', toFile: 'references/extra.md' }], 'foreground')
    expect(moved.ok, moved.message).toBe(true)
    const unit = newestUnitId(await lib.listVersions('u-skill'))
    expect(unit).toBeDefined()
    const undone = await curator.undoUnit('u-skill', unit)
    expect(undone.ok, undone.message).toBe(true)
    expect(await lib.read('u-skill')).toBe(before)
    expect(existsSync(join(home, 'skills', 'u-skill', 'references', 'extra.md'))).toBe(false)
  } finally { await rm(home, { recursive: true, force: true }) }
})

it('R-G3a-4：追加型搬移必须写回旧字节、不得删文件', async () => {
  const { home, curator, lib, file } = await setup()
  try {
    await lib.writeSupportFile('u-skill', 'references/x.md', 'pre-unit bytes' + stamp, 'foreground')
    const moved = await lib.restructure('u-skill', [{ heading: 'Extra', toFile: 'references/x.md' }], 'foreground')
    expect(moved.ok, moved.message).toBe(true)
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('extra content')
    const unit = newestUnitId(await lib.listVersions('u-skill'))
    const undone = await curator.undoUnit('u-skill', unit)
    expect(undone.ok, undone.message).toBe(true)
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('pre-unit bytes' + stamp)
  } finally { await rm(home, { recursive: true, force: true }) }
})

it('R-G3a-3：支撑文件被手改过 ⇒ 零写拒绝，文件原样保留', async () => {
  const { home, curator, lib } = await setup()
  try {
    const target = join(home, 'skills', 'u-skill', 'references', 'extra.md')
    const moved = await lib.restructure('u-skill', [{ heading: 'Extra', toFile: 'references/extra.md' }], 'foreground')
    expect(moved.ok, moved.message).toBe(true)
    expect(existsSync(target)).toBe(true)
    const handEdited = 'hand edited' + stamp
    writeFileSync(target, handEdited)
    const unit = newestUnitId(await lib.listVersions('u-skill'))
    const undone = await curator.undoUnit('u-skill', unit)
    expect(undone.ok).toBe(false)
    expect(existsSync(target)).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe(handEdited)
  } finally { await rm(home, { recursive: true, force: true }) }
})
