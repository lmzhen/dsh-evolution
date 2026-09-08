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

// Compile-time satisfiability (G1.3, F-340): the node backend (with its
// `name`) must satisfy the narrowed seam. A backend/seam drift fails `tsc`.
const _nodeProviderIsSeam: EvolutionIo = { name: 'node', ...nodeEvolutionIo() }
void _nodeProviderIsSeam

export const name = 'evolution-io-node'
export const inject = ['evolutionIo']

export function apply(ctx: Context): void {
  const provider: EvolutionIo = {
    name: 'node',
    ...nodeEvolutionIo(),
  }
  // P3-11 (v14): a second apply (HMR or a re-mounted row) must not throw
  // "already registered" — our own provider being present is the idempotent
  // case; a DIFFERENT provider under the same name still fails loud in
  // registerProvider.
  if (ctx.evolutionIo.hasProvider(provider.name)) return
  // P2-7 (v14): declare the node backend as the nameless `provider()` default
  // so an additionally registered backend cannot silently become the one every
  // production consumer resolves.
  ctx.effect(() => ctx.evolutionIo.registerProvider(provider, { default: true }), 'evolution-io-node.provider')
}
