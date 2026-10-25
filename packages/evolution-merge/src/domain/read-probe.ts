/** Three-state reads for merge diagnostics: callers that render absence as none. */
import { probeList, probeText, type EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'

export async function readTextOrNull(io: EvolutionIoLike, path: string): Promise<string | null> {
  const probe = await probeText(io, path)
  return probe.kind === 'present' ? probe.value : null
}

export async function listOrEmpty(io: EvolutionIoLike, path: string): Promise<readonly string[]> {
  const probe = await probeList(io, path)
  return probe.kind === 'present' ? probe.value : []
}
