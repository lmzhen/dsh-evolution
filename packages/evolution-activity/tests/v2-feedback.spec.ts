// @tier fast
import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createStoreService, HomeFence, nodeEvolutionIo, StoreKernel } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { EvolutionFeedback } from '../src/feedback/index.ts'
import { STATE_V2_MIGRATION_MARKER } from '@deepseek-ai/dsh-evolution-core/state/storage'

describe('feedback cache through the MVCC bridge', () => {
  it('reads the rebuild cache from the feedback domain under the v2 marker', async () => {
    const root = await tempRoot('dsh-feedback-v2-')
    const evolution = join(root, 'evolution')
    await mkdir(join(evolution, 'state'), { recursive: true })
    await writeFile(join(evolution, 'state', STATE_V2_MIGRATION_MARKER), '{}\n')
    const io = nodeEvolutionIo()
    const fence = new HomeFence({ home: evolution })
    const kernel = new StoreKernel({ io, home: evolution, fence })
    await kernel.bootstrap({ feedback: { text: '{"version":2,"lastSeq":0,"skills":{},"sessions":{}}\n' } })
    const feedback = new EvolutionFeedback(io, root, undefined, () => {}, fence)
    await expect(feedback.recent()).resolves.not.toBeNull()
  })

  it('routes the rebuild cache through the feedback service when supplied', async () => {
    const root = await tempRoot('dsh-feedback-service-')
    const evolution = join(root, 'evolution')
    await mkdir(join(evolution, 'state'), { recursive: true })
    await writeFile(join(evolution, 'state', STATE_V2_MIGRATION_MARKER), '{}\n')
    const io = nodeEvolutionIo()
    const fence = new HomeFence({ home: evolution })
    const kernel = new StoreKernel({ io, home: evolution, fence })
    await kernel.bootstrap({ feedback: { text: '{"version":2,"lastSeq":0,"skills":{},"sessions":{}}\n' } })
    const feedback = new EvolutionFeedback(io, root, undefined, () => {}, fence, createStoreService(kernel))
    await expect(feedback.recent()).resolves.not.toBeNull()
  })

  it('accepts the service at attach time without freezing the bridge', async () => {
    const root = await tempRoot('dsh-feedback-attach-')
    const evolution = join(root, 'evolution')
    await mkdir(join(evolution, 'state'), { recursive: true })
    await writeFile(join(evolution, 'state', STATE_V2_MIGRATION_MARKER), '{}\n')
    const io = nodeEvolutionIo()
    const fence = new HomeFence({ home: evolution })
    const kernel = new StoreKernel({ io, home: evolution, fence })
    await kernel.bootstrap({ feedback: { text: '{"version":2,"lastSeq":0,"skills":{},"sessions":{}}\n' } })
    const feedback = new EvolutionFeedback(io, root, undefined, () => {})
    feedback.attachIo(io, createStoreService(kernel))
    await expect(feedback.recent()).resolves.not.toBeNull()
  })
})
