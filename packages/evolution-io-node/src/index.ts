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

// P2-3 (v15): the provider is a MODULE-level singleton. `nodeEvolutionIo()`
// carries no per-instance state (its cross-call bookkeeping, e.g.
// `pendingSelfCleanup`, is already module-level in core), so instances are
// interchangeable — a single identity makes the registry's identical-object
// idempotency work: a second apply (HMR / re-mounted row) re-registers the
// SAME object and gets the original dispose instead of "already registered".
const provider: EvolutionIo = { name: 'node', ...nodeEvolutionIo() }

export function apply(ctx: Context): void {
  // P2-7 (v14): declare the node backend as the nameless `provider()` default
  // so an additionally registered backend cannot silently become the one every
  // production consumer resolves.
  // P2-3 (v15): no `hasProvider` early-return — the v14 early-return made the
  // "foreign provider under the same name fails loud" contract UNREACHABLE
  // (any name collision was silently swallowed, and the second mount silently
  // dropped its default declaration and dispose). The registry now
  // distinguishes: identical object → idempotent; different object → throw.
  ctx.effect(() => ctx.evolutionIo.registerProvider(provider, { default: true }), 'evolution-io-node.provider')
}
