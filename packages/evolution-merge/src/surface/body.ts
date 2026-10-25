import { readTextOrNull } from '../domain/read-probe.ts'
/** Body resolution over a snapshot ref: stage body wins; lost/expired stage returns null. */
import { join } from 'node:path'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { BodyRef } from '../domain/merge-snapshot.ts'
import { readStageEntry } from '../domain/stage-aggregate.ts'

export async function resolveBody(io: EvolutionIoLike, home: string, ref: BodyRef, rowBody: () => Promise<string | null>): Promise<string | null> {
  const stage = await readStageEntry(io, home, ref.rowId).catch(() => null)
  if (stage !== null && (stage.state === 'lost' || stage.state === 'expired')) return null
  if (stage !== null && stage.state === 'present') {
    const staged = await readTextOrNull(io, join(home, 'merge', 'runs', stage.ref, 'merged', ref.name))
    if (staged !== null) return staged
  }
  return await rowBody()
}
