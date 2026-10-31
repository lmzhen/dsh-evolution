// @tier ci-only
import { afterEach, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import * as toolSkill from '@deepseek-ai/dsh-tool-skill'
import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import EvolutionIoRegistry from '../../evolution-io/src/index.ts'
import * as discoveryPlugin from '../src/plugin.ts'
import { skillKeyOf } from '../src/index.ts'

const dirs: string[] = []
const oldHome = process.env.DSH_HOME
afterEach(async () => { process.env.DSH_HOME = oldHome; for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

async function skill(root: string, name: string): Promise<void> {
  const dir = join(root, name); await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '---\nname: ' + name + '\ndescription: ' + name + ' description.\n---\n\nbody\n')
  await writeFile(join(dir, '.hermes-managed'), '')
}
const nodeIo = {
  async readText(path: string) { try { return await readFile(path, 'utf8') } catch { return null } },
  async writeText(path: string, content: string) { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, content) },
  async remove(path: string) { await rm(path, { recursive: true, force: true }) },
  async list(path: string) { try { return await readdir(path) } catch { return [] } },
  async exists(path: string) { try { await readFile(path); return true } catch { return false } },
  async rename(from: string, to: string) { await rename(from, to) },
  async copy(from: string, to: string) { await writeFile(to, await readFile(from)) },
}

it('filters a disabled domain through the real plugin skill_search', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-discovery-disabled-')); dirs.push(dir)
  const dshHome = join(dir, '.dsh'); process.env.DSH_HOME = dshHome
  const skillsRoot = join(dshHome, 'skills')
  await skill(skillsRoot, 'alpha'); await skill(skillsRoot, 'beta')
  const mapPath = join(dir, 'map.json')
  const ctx = new Context()
  provideWorkingDirectoryFixture(ctx, dir)
  await ctx.plugin(EvolutionIoRegistry)
  ctx.evolutionIo.registerProvider({ name: 'test', ...nodeIo })
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, { dshHome, agentsHome: join(dir, '.agents'), watch: false })
  await ctx.plugin(toolSkill)
  await writeFile(mapPath, JSON.stringify({ schemaVersion: 1, mapVersion: '1', domains: [{ id: 'd', name: 'Disabled', purpose: 'disabled domain', description: 'd', inScope: ['a'], outOfScope: ['b'], triggers: ['t'], parentIds: [], status: 'active', version: 1, createdAt: 0, updatedAt: 0, descriptionHash: 'h', descriptionVersion: 1, descriptionStatus: 'fresh', provenance: {}, quality: {} }], edges: [{ skillKey: skillKeyOf({ provider: 'filesystem', source: 'user-dsh', name: 'alpha' }), domainId: 'd', role: 'primary', confidence: 1, source: 'manual', skillHash: 'h', mapVersion: '1', status: 'active', assignedAt: 0 }] }))
  await ctx.plugin(discoveryPlugin, { domainMapPath: mapPath, sessionPath: join(dir, 'sessions.json'), featureEpoch: 'e', mode: 'on', disableDomains: ['d'] })
  const result = await ctx.get('tools')!.execute({ signal: new AbortController().signal, callId: ToolCallId('disabled-search'), name: 'skill_search', arguments: { query: 'alpha beta' } })
  expect(JSON.stringify(result.content)).not.toContain('alpha')
  expect(JSON.stringify(result.content)).toContain('beta')
})
