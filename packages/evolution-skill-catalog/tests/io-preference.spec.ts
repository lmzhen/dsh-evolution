// @tier ci-only
/**
 * G2 S1: the migrated reader must actually USE the preferred backend — and still work without it.
 *
 * Deployment A registers only the node backend: the reader falls back to the default (contract C2
 * degradation). Deployment B additionally mounts a provider named \`fs\` and the reads MUST go through
 * it: the count is the observable evidence, because "switched to the platform backend" is otherwise a
 * statement about source code, not about behaviour.
 *
 * G5 step 4: the counter comes from test-support/counting-io.ts (one wrapper for the four specs that
 * assert this same invariant); this file keeps only the catalog SUBJECT.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-evolution-core'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as Catalog from '../src/index.ts'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { join } from 'node:path'
import { countingIo } from '../../test-support/counting-io.ts'
import { tempRoot } from '../../test-support/temp-home.ts'

describe('G2 S1: the reader prefers the platform backend when the deployment mounts one', () => {
  it('serves catalog reads through the fs provider, and falls back to the default without it', async () => {
    const root = await tempRoot('dsh-skill-catalog-fs-')
    const base = nodeEvolutionIo()
    const content = '---\nname: demo\ndescription: Demo skill.\n---\n\n# Demo\n'
    await base.writeText(join(root, 'demo', 'SKILL.md'), content)

    // Deployment A: only the node backend.
    const onlyNode = new Context()
    await onlyNode.plugin(SkillRegistry)
    await onlyNode.plugin(EvolutionIoRegistry)
    await onlyNode.plugin(NodeIo)
    await onlyNode.plugin(Catalog, { root })
    expect((await onlyNode.skills.get('demo'))?.name).toBe('demo')

    // Deployment B: node stays the default AND a platform backend is mounted (the S0 state).
    const counted = countingIo(base)
    const withFs = new Context()
    await withFs.plugin(SkillRegistry)
    await withFs.plugin(EvolutionIoRegistry)
    await withFs.plugin(NodeIo)
    withFs.evolutionIo.registerProvider({ name: 'fs', ...counted.provider })
    await withFs.plugin(Catalog, { root })
    const skill = await withFs.skills.get('demo')
    expect(skill?.name).toBe('demo')
    // Observable evidence: the migrated reader resolved \`fs\`, not the default backend.
    expect(counted.calls()).toBeGreaterThan(0)
  })
})
