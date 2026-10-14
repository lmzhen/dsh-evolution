// @tier pre-tag
/**
 * G2 S3 evidence for the skill-usage seam: `record()` writes through `this.io`, so a counting platform
 * backend must observe the write. This is the decisive experiment for the feedback evidence: feedback
 * persists via THIS service, and this spec proves the service really uses the preferred backend.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import SkillUsageRegistry from '../src/index.ts'
import { countingIo } from '../../test-support/counting-io.ts'
import { tempRoot } from '../../test-support/temp-home.ts'

describe('G2 S3: skill-usage writes through the platform backend when mounted', () => {
  it('serves record() through the fs provider, and works without it', async () => {
    const root = await tempRoot('dsh-usage-fs-')

    const onlyNode = new Context()
    await onlyNode.plugin(EvolutionIoRegistry)
    await onlyNode.plugin(NodeIo)
    await onlyNode.plugin(SkillUsageRegistry, { root })
    await onlyNode.skillUsage.record('demo', 'use')
    expect((await onlyNode.skillUsage.report()).get('demo')?.use_count).toBe(1)

    // G5 step 4: the counter is the SHARED wrapper (test-support/counting-io.ts). It wraps EVERY
    // method, which matters most for the RMW entry point: `mutateUsage` writes through `transact`,
    // so a wrapper that only counted readText/writeText would see ZERO calls while the seam is in use.
    const base = nodeEvolutionIo()
    const counted = countingIo(base)
    const withFs = new Context()
    await withFs.plugin(EvolutionIoRegistry)
    await withFs.plugin(NodeIo)
    withFs.evolutionIo.registerProvider({ name: 'fs', ...counted.provider })
    await withFs.plugin(SkillUsageRegistry, { root })
    await withFs.skillUsage.record('demo', 'use')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(counted.calls()).toBeGreaterThan(0)
  })
})
