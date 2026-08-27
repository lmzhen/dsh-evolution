/**
 * Local atomic node:fs IO provider.
 *
 * The implementation is the single `nodeEvolutionIo()` from
 * `dsh-evolution-core` (no duplicate copy: the old fork once diverged in
 * exists(), made directories report absent and let re-archives overwrite
 * older archive folders). Only the provider's `name` is added here.
 *
 * @module @deepseek-ai/dsh-evolution-io-node
 */

import type { Context } from '@deepseek-ai/cordis'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionIo } from '@deepseek-ai/dsh-evolution-io'

export const name = 'evolution-io-node'
export const inject = ['evolutionIo']

export function apply(ctx: Context): void {
  const provider: EvolutionIo = {
    name: 'node',
    ...nodeEvolutionIo(),
  }
  ctx.effect(() => ctx.evolutionIo.registerProvider(provider), 'evolution-io-node.provider')
}
