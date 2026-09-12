/**
 * Mount the state-backed plugin stack the state/approval suites repeat per test.
 *
 * The stack is always mounted per test (never hoisted: the suites pin their own
 * projection/storage wiring), so the only shared part is the order and the
 * arguments — the options select how far up the stack a test needs to go.
 */
import { Context } from '@deepseek-ai/cordis'
import EvolutionStateStorageRegistry from '@deepseek-ai/dsh-evolution-state-storage'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import * as JsonState from '@deepseek-ai/dsh-evolution-state-json'
import EvolutionState from '@deepseek-ai/dsh-evolution-state'
import EvolutionApproval from '@deepseek-ai/dsh-evolution-approval'

/**
 * Build a fresh Context carrying the state stack rooted at `root`.
 * @param root - evolution home the JSON state provider writes under.
 * @param options - `evolution` adds the state facade, `approval` the approval service.
 * @returns the mounted context.
 */
export async function mountStateStack(
  root: string,
  options: { evolution?: boolean; approval?: boolean } = {},
): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(EvolutionStateStorageRegistry)
  await ctx.plugin(EvolutionIoRegistry)
  await ctx.plugin(NodeIo)
  await ctx.plugin(JsonState, { root })
  if (options.evolution) await ctx.plugin(EvolutionState)
  if (options.approval) await ctx.plugin(EvolutionApproval, { enabled: true, stageForeground: true })
  return ctx
}
