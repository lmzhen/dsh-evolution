// @tier pre-tag
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionCurator from '../src/index.ts'

it('curator proposes keep for a body-oversize skill', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-propose-keep-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const ctx = new Context()
    await ctx.plugin(EvolutionIoRegistry)
    await ctx.plugin(NodeIo)
    const curator = new EvolutionCurator(ctx, { autoStart: false })
    const body = '---\nname: big-keep\ndescription: big keep.\n---\n\n' + 'x'.repeat(20_500)
    const created = await curator.skills.create('big-keep', body, 'foreground')
    expect(created.ok, created.message).toBe(true)
    const result = await curator.proposeKeeps()
    expect(result.count).toBe(1)
    const dir = join(home, 'evolution', 'reports')
    const names = await readdir(dir)
    const raw = await readFile(join(dir, names[0]!), 'utf8')
    const proposal = JSON.parse(raw) as { outcome: string; provenance: { runId: string; promptVersion: string } }
    expect(proposal.outcome).toBe('keep')
    expect(proposal.provenance.promptVersion).toBe('v1')
    expect(proposal.provenance.runId).toContain('curator-keep-')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})
